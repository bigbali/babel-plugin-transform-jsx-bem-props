import {
    NodePath,
    PluginObj as Plugin,
    types
} from '@babel/core';
import {
    Attribute,
    BEMProps,
    BEMPropTypes,
    Block,
    isArray
} from './types';
import {
    BEM_PROP_TYPES
} from './constants';
import removeAttrPaths from './removeAttrPaths';
import constructClassNameAttribute from './construct';

export type NPJSXAttribute = NodePath<types.JSXAttribute>;

type SupportedTypes = types.ArrayExpression
    | types.CallExpression
    | types.ObjectExpression
    | types.StringLiteral
    | types.TemplateLiteral
    | types.Identifier;

type Options = {
    allowStringLiteral: boolean,
    allowTemplateLiteral: boolean,
    allowArrayExpression: boolean,
    allowCallExpression: boolean,
    allowObjectExpression: boolean,
    allowIdentifier: boolean,
    allowFalsyValue: boolean,
    arrayMaxLength: number
};

const DEFAULT_OPTIONS: Options = {
    allowStringLiteral: true,
    allowTemplateLiteral: true,
    allowArrayExpression: true,
    allowCallExpression: true,
    allowObjectExpression: true,
    allowIdentifier: false,
    allowFalsyValue: false,
    arrayMaxLength: 3
};

let OPTIONS = DEFAULT_OPTIONS;

export default function transformJSXBEMAttributes(): Plugin {
    return {
        name: 'transform-jsx-bem-attributes',
        visitor: {
            JSXElement(element, { opts }) {
                OPTIONS = {
                    ...DEFAULT_OPTIONS,
                    ...opts
                };
                traverseJSXElementTree(element, null);

                // Don't traverse child nodes, as we will do that manually
                element.skipKey('children');
            }
        }
    };
};

/**
 * Recursively traverses the JSXElement tree and constructs the 'className' attribute
 * @param element - The JSXElement to recursively traverse
 * @param block - Passed to the next iteration to allow block inheritance
 */
const traverseJSXElementTree = (element: NodePath<types.JSXElement>, block: Block) => {
    const openingElement = element.get('openingElement');
    const attrPaths = openingElement.get('attributes');
    let isClassNameOnly = true;
    let isBlockInherited = true;

    const BEM_PROPS: BEMProps = {
        block,
        elem: null,
        mods: null,
        className: null
    };

    const assignValue = <T>(
        attrName: keyof BEMProps,
        attrValue: T,
        attrKey?: keyof T,
        attrPath?: NPJSXAttribute
    ) => {
        const value = (attrKey ? attrValue[attrKey] : attrValue);

        // @ts-ignore
        if (!value || types.isArrayExpression(value) && value.elements.length === 0) {
            if (OPTIONS.allowFalsyValue) {
                console.warn('An empty array or falsy value was passed in. Disable allowFalsyValue to see where.');
            } else {
                attrPath && throwError(attrPath.buildCodeFrameError('Empty array or falsy value was passed in.'));
            }
        }

        BEM_PROPS[attrName] = value as SupportedTypes & null;

        if (attrName === BEMPropTypes.BLOCK) {
            isBlockInherited = false;
        }

        return true;
    };

    const assignOrThrow = (
        attrName: keyof BEMProps,
        attrPath: NPJSXAttribute,
        value: SupportedTypes,
        key: keyof Options
    ) => {
        OPTIONS[key] && assignValue(attrName, value) || throwError(attrPath.buildCodeFrameError(
            `You tried to use a value with type '${value.type}', but '${key}' is explicitly set to false.`
        ));
    };

    const attrPathsToRemove: NPJSXAttribute[] = [];
    attrPaths.forEach(attrPath => {
        const { node } = attrPath;

        if (types.isJSXSpreadAttribute(node)) {
            return; // There's not much we can do with spread attributes, so let's skip them
        }

        const {
            value: attrValue,
            name: {
                name: attrName
            }
        } = node as Attribute;

        if (!BEM_PROP_TYPES.includes(attrName)) {
            return;
        }

        if (attrName !== BEMPropTypes.CLASSNAME) {
            isClassNameOnly = false;
        }

        if (types.isStringLiteral(attrValue)) {
            assignOrThrow(attrName, attrPath as NPJSXAttribute, attrValue, 'allowStringLiteral');
        }

        if (types.isJSXExpressionContainer(attrValue)) {
            const { expression } = attrValue;

            if (types.isStringLiteral(expression)) {
                assignOrThrow(attrName, attrPath as NPJSXAttribute, expression, 'allowStringLiteral');
            } else if (types.isCallExpression(expression)) {
                assignOrThrow(attrName, attrPath as NPJSXAttribute, expression, 'allowCallExpression');
            } else if (types.isTemplateLiteral(expression)) {
                assignOrThrow(attrName, attrPath as NPJSXAttribute, expression, 'allowTemplateLiteral');
            } else if (types.isArrayExpression(expression)) {
                if (expression.elements.length > OPTIONS.arrayMaxLength) {
                    throwError(attrPath.buildCodeFrameError(`Array length exceeds maximal length: ${OPTIONS.arrayMaxLength}.`));
                }

                assignOrThrow(attrName, attrPath as NPJSXAttribute, expression, 'allowArrayExpression');
            } else if (types.isIdentifier(expression)) {
                OPTIONS.allowIdentifier && assignValue(attrName, expression) || throwError(attrPath.buildCodeFrameError(
                    `You tried to use an identifier as a value, but 'allowIdentifier' is set to false.
                    To enable it, pass "allowIdentifier": true as a plugin option.`
                ));
            } else if (types.isObjectExpression(expression) && attrName === BEMPropTypes.MODS) {
                OPTIONS.allowObjectExpression && assignValue(attrName, expression, 'properties')
                    || throwError(attrPath.buildCodeFrameError(
                        'You tried to use an object expression as a value, but \'allowObjectExpression\' is explicitly set to false.'
                    ));
            } else {
                throw attrPath.buildCodeFrameError(`Attribute value of type ${expression.type || 'unknown'} is unsupported.`);
            }
        }

        attrPathsToRemove.push(attrPath as NPJSXAttribute);
    });

    removeAttrPaths(attrPathsToRemove);

    const classNameAttribute = constructClassNameAttribute(BEM_PROPS, isBlockInherited, element);

    if (classNameAttribute) {
        element.node.openingElement.attributes.push(types.jsxAttribute(
            types.jsxIdentifier('className'), // @ts-ignore
            types.jsxExpressionContainer(classNameAttribute)
        ));
    }

    element.get('children').forEach(childElement => { // Here happens the recursive traversal
        if (types.isJSXElement(childElement.node)) {
            traverseJSXElementTree(childElement as NodePath<types.JSXElement>, BEM_PROPS.block);
        }
    });
};

/**
 * A wrapper around the 'throw' keyword to allow use in logical expressions.
 */
const throwError = (error: Error) => {
    throw error;
};
