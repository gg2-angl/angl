var _ = require('lodash');
var astUtils = require('./ast-utils');
var strings = require('./strings');

var buffer
  , print
  , indentationLevel
  ;

var initializeCompiler = function() {
    buffer = [];
    print = _.bind(buffer.push, buffer);
    indentationLevel = 0;
};

var indent = function() {
    indentationLevel++;
};

var outdent = function() {
    indentationLevel--;
    if(indentationLevel < 0) {
        throw new Error('Tried to outdent too far.');
    }
};

var printIndent = function() {
    // TODO create customizable indentation level
    // TODO make this faster?
    _.times(indentationLevel, function() {
        print('    ');
    });
};

// TODO properly translate all binops and unops:
//   ones that GML has that JS doesn't have
//   ones with different behavior that need to be implemented differently
//   DIV, MOD, ^^, bitwise ops
//   how does GML do type coercion (42 + "hello world")?  Do I need to emulate that behavior?
var generateExpression = function(astNode, omitIndentation) {
    switch(astNode.type) {

        case 'identifier':
            var variable = astNode.variable;
            if(variable) {
                if(variable.getAccessType() === 'PROP_ACCESS') {
                    print(variable.getContainingObjectIdentifier() + '.');
                }
                print(variable.getJsIdentifier());
            } else {
                print(astNode.name);
            }
            // TODO will this ever need to be enclosed in parentheses?
            // How should I be handling this in the general case?
            break;

        case 'binop':
            switch(astNode.op) {
                // special-case the dot operator - no brackets!
                case '.':
                    generateExpression(astNode.expr1);
                    print('.');
                    generateExpression(astNode.expr2);
                    break;

                case 'div':
                    print('((');
                    generateExpression(astNode.expr1);
                    print(' / ');
                    generateExpression(astNode.expr2);
                    print(')|0)');
                    break;

                case 'mod':
                    print('(');
                    generateExpression(astNode.expr1);
                    print(' % ');
                    generateExpression(astNode.expr2);
                    print(')');
                    break;
                
                case '||':
                    // Implement OR without short-circuit evaluation
                    // Coerce both sides to booleans, add them, coerce that to a boolean, then coerce that to a number
                    print('(!!(!!( ');
                    generateExpression(astNode.expr1);
                    print(' )+!!( ');
                    generateExpression(astNode.expr2);
                    print(' ))|0)');
                    break;
                
                case '&&':
                    // Implement AND without short-circuit evaluation
                    // Coerce both sides to booleans, then multiply them
                    print('(!!( ');
                    generateExpression(astNode.expr1);
                    print(' )*!!( ');
                    generateExpression(astNode.expr2);
                    print(' ))');
                    break;
                
                case '^^':
                    // Implement XOR without short-circuit evaluation
                    // Coerce both sides to boolean and "not" them, add them, subtract 1, coerce to boolean and "not", coerce to number
                    print('(!((!( ');
                    generateExpression(astNode.expr1);
                    print(' )+!( ');
                    generateExpression(astNode.expr2);
                    print(' ))-1)|0)');
                    break;
                    
                default:
                    print('(');
                    generateExpression(astNode.expr1);
                    print(' ' + astNode.op + ' ');
                    generateExpression(astNode.expr2);
                    print(')');
                    break;
            }
            break;

        case 'unop':
            print('(');
            print(astNode.op);
            generateExpression(astNode.expr);
            print(')');
            break;

        case 'number':
            print('(');
            print(astNode.val.toString());
            // TODO does toString always produce valid Javascript that will create the exact same number?
            print(')');
            break;

        case 'string':
            print(JSON.stringify(astNode.val));
            // TODO this fails in a select few corner cases.  Use something better,
            // perhaps stolen from the Jade source code
            break;

        case 'index':
            // TODO this needs a lot of work
            // What do we do when index values aren't numbers?  Aren't integers?
            // What about when the array isn't initialized or the target isn't an array?
            print('(');
            generateExpression(astNode.expr);
            print(')');
            _.each(astNode.indexes, function (index) {
                print('[');
                generateExpression(index);
                print(']');
            });
            break;

        case 'funccall':
            print('(');
            generateExpression(astNode.expr);
            print(')');
            if(astNode.isMethodCall) {
                // Method calls: `self`/`this` is automatically set to the object to which the method belongs
                // `other` should be set to the local `self` value
                print('(');
                generateExpression({
                    type: 'identifier',
                    variable: astUtils.getAnglScope(astNode).getVariableByIdentifierInChain('other')
                });
            } else {
                // Function calls: Function's `self` and `other` are the local `self` and `other` values
                print('.call(');
                generateExpression({
                    type: 'identifier',
                    variable: astUtils.getAnglScope(astNode).getVariableByIdentifierInChain('self')
                });
                print(', ');
                generateExpression({
                    type: 'identifier',
                    variable: astUtils.getAnglScope(astNode).getVariableByIdentifierInChain('other')
                })
            }
            _.each(astNode.args, function(arg, i, args) {
                print(', ');
                generateExpression(arg);
            });
            print(')');
            break;

        case 'script':
            print('function(');
            print(['other'].concat(astNode.args).join(', '));
            print(') {\n');
            indent();
            generateLocalVariableAllocation(astNode);
            // TODO this part of the AST doesn't seem quite right, suggesting there are
            // possibilities I'm not aware of.
            // These sanity checks will reject anything unexpected.
            /*if(!(_.isObject(astNode.stmts) && _(_.keys(astNode.stmts).sort()).isEqual(['list', 'type']) && astNode.stmts.type === 'statements' && _.isArray(astNode.stmts.list))) {
             throw new Error('Failed sanity checks on stmts!')
             }
             _.each(astNode.stmts.list, generateStatement)*/
            generateStatement(astNode.stmts);
            outdent();
            omitIndentation || printIndent();
            print('}');
            break;

        case 'jsfunccall':
            print('(');
            print(astNode.expr);
            print(')(');
            _.each(astNode.args, function(arg, i) {
                if(i) print(', ');
                generateExpression(arg);
            });
            print(')');
            break;

        case 'jsexpr':
            print(astNode.expr);
            break;

        default:
            throw new Error('Unknown expression type: "' + astNode.type + '"');
    }
};

var generateStatement = function(astNode, omitTerminator, omitIndentation) {
    if(arguments.length < 2) omitTerminator = false;
    switch(astNode.type) {

        case 'var':
            omitIndentation || printIndent();
            print('var ');
            _.each(astNode.list, function (varNode, i, args) {
                print (varNode.name);
                if (varNode.hasOwnProperty('expr')) {
                    print (' = ');
                    generateExpression(varNode.expr);
                }
                if(i < args.length - 1) {
                    print(', ');
                }
            });
            break;

        case 'assign':
            omitIndentation || printIndent();
            generateExpression(astNode.lval);
            print(' = ');
            generateExpression(astNode.rval);
            break;

        case 'scriptdef':
            omitIndentation || printIndent();
            print(strings.ANGL_GLOBALS_IDENTIFIER + '.' + astNode.name);
            print(' = function(');
            print(['other'].concat(astNode.args).join(', '));
            print(') {\n');
            indent();
            generateLocalVariableAllocation(astNode);
            // TODO this part of the AST doesn't seem quite right, suggesting there are
            // possibilities I'm not aware of.
            // These sanity checks will reject anything unexpected.
            /*if(!(_.isObject(astNode.stmts) && _(_.keys(astNode.stmts).sort()).isEqual(['list', 'type']) && astNode.stmts.type === 'statements' && _.isArray(astNode.stmts.list))) {
                throw new Error('Failed sanity checks on stmts!')
            }
            _.each(astNode.stmts.list, generateStatement)*/
            generateStatement(astNode.stmts);
            outdent();
            omitIndentation || printIndent();
            print('}');
            break;

        case 'const':
            omitIndentation || printIndent();
            print(strings.ANGL_GLOBALS_IDENTIFIER + '.' + astNode.name);
            print(' = ');
            generateExpression(astNode.expr);
            break;

        case 'switch':
            omitIndentation || printIndent();
            print('switch(');
            generateExpression(astNode.expr);
            print(') {\n');
            indent();
            _.each(astNode.cases, function(caseNode) {
                generateCase(caseNode);
            });
            outdent();
            omitIndentation || printIndent();
            print('}');
            break;

        case 'for':
            omitIndentation || printIndent();
            print('for(');
            generateStatement(astNode.initstmt, true, true);
            print('; ');
            generateExpression(astNode.contexpr);
            print('; ');
            generateStatement(astNode.stepstmt, true, true);
            print(') {\n');
            indent();
            // TODO I bet there are some scoping issues I'm not dealing with correctly.
            generateStatement(astNode.stmt);
            outdent();
            omitIndentation || printIndent();
            print('}');
            break;

        case 'ifelse':
            omitIndentation || printIndent();
            print('if(');
            generateExpression(astNode.expr);
            print(') {\n');
            indent();
            generateStatement(astNode.stmt1);
            outdent();
            omitIndentation || printIndent();
            print('} else {\n');
            indent();
            generateStatement(astNode.stmt2);
            outdent();
            omitIndentation || printIndent();
            print('}');
            break;

        case 'if':
            // This is a special case of ifelse where the else block is empty.
            generateStatement({
                type: 'ifelse',
                expr: astNode.expr,
                stmt1: astNode.stmt,
                stmt2: {type: 'nop'}
            }, omitTerminator, omitIndentation);
            break;

        case 'while':
            omitIndentation || printIndent();
            print('while(');
            generateExpression(astNode.expr);
            print(') {\n');
            indent();
            generateStatement(astNode.stmt);
            outdent();
            printIndent();
            print('}');
            break;

        case 'dountil':
            omitIndentation || printIndent();
            print('do {\n');
            indent();
            generateStatement(astNode.stmt);
            outdent();
            omitIndentation || printIndent();
            print('} while(!(');
            generateExpression(astNode.expr);
            print('))');
            break;

        case 'break':
            omitIndentation || printIndent();
            print('break');
            // TODO are break semantics ever different in Angl than they are in JS?
            break;

        case 'continue':
            omitIndentation || printIndent();
            print('continue');
            // TODO are continue semantics ever different in Angl than they are in JS?
            break;

        case 'statements':
            _.each(astNode.list, function(statement) {
                generateStatement(statement);
            });
            break;

        case 'funccall':
        case 'jsfunccall':
            // Delegate to the expression generator
            omitIndentation || printIndent();
            generateExpression(astNode);
            break;

        case 'with':
            // TODO I DONT WANNA IMPLEMENT THIS WAAAAAH
            // Also it requires some sort of runtime that can find all instances of
            // a given object type to iterate over.
            // For now, I'm emitting a comment that explains code has been omitted.
            var indexIdentifier = {
                type: 'identifier',
                variable: astNode.indexVariable
            };
            var allObjectsIdentifier = {
                type: 'identifier',
                variable: astNode.allObjectsVariable
            };
            var innerSelfIdentifier = {
                type: 'identifier',
                variable: astUtils.getAnglScope(astNode).getVariableByIdentifier('self')
            };
            omitIndentation || printIndent();
            print('for(');
            generateExpression(indexIdentifier);
            print(' = 0; ');
            generateExpression(indexIdentifier);
            print(' < ');
            generateExpression(allObjectsIdentifier);
            print('.length; ');
            generateExpression(indexIdentifier);
            print('++) {\n');
            indent();
            // Assign the value of inner `self`
            omitIndentation || printIndent();
            generateExpression(innerSelfIdentifier);
            print(' = ');
            generateExpression(allObjectsIdentifier);
            print('[');
            generateExpression(indexIdentifier);
            print('];\n');
            generateStatement(astNode.stmt);
            outdent();
            omitIndentation || printIndent();
            print('}');
            break;

        case 'return':
            // TODO is there ever a situation where a Javascript 'return' won't do what we want?
            // For example, inside a _.each() iterator function
            omitIndentation || printIndent();
            print('return (');
            generateExpression(astNode.expr);
            print(')');
            break;

        case 'exit':
            // TODO same caveats as 'return'
            omitIndentation || printIndent();
            print('return');
            break;

        case 'object':
            var objectExpr = strings.ANGL_GLOBALS_IDENTIFIER + '.' + astNode.name;
            var protoExpr = objectExpr + '.prototype';
            var parentObjectExpr = strings.ANGL_GLOBALS_IDENTIFIER + '.' + astNode.parent;
            var parentProtoExpr = parentObjectExpr + '.prototype';
            // Wrap object creation within a closure, and pass that closure into the proper runtime method.
            // The Angl runtime will take care of creating objects in the proper order, so that the parent object
            // already exists.
            omitIndentation || printIndent();
            print(strings.ANGL_RUNTIME_IDENTIFIER + '.createAnglObject(' +
                  JSON.stringify(astNode.name) + ', ' + JSON.stringify(astNode.parent) + ', ');
            print('function() {\n');
            indent();
            // Generate the constructor function
            omitIndentation || printIndent();
            print(objectExpr + ' = function() { ' + parentObjectExpr + '.apply(this, arguments); };\n');
            // Set up inheritance
            omitIndentation || printIndent();
            print(strings.ANGL_RUNTIME_IDENTIFIER + '.inherit(' + objectExpr + ', ' + parentObjectExpr + ');\n');
            // Generate the property initialization function
            omitIndentation || printIndent();
            print(protoExpr + '.' + strings.OBJECT_INITPROPERTIES_METHOD_NAME + ' = ');
            generateExpression(astNode.propertyinitscript);
            print(';\n');
            // Generate the create event, if specified
            if(astNode.createscript) {
                omitIndentation || printIndent();
                print(protoExpr + '.$create = ');
                generateExpression(astNode.createscript);
                print(';\n');
            }
            // Generate the destroy event, if specified
            if(astNode.destroyscript) {
                omitIndentation || printIndent();
                print(protoExpr + '.$destroy = ');
                generateExpression(astNode.destroyscript);
                print(';\n');
            }
            // Generate all methods
            _.each(astNode.methods, function(method) {
                omitIndentation || printIndent();
                print(protoExpr + '.' + method.methodname + ' = ');
                generateExpression(method);
                print(';\n');
            });
            outdent();
            omitIndentation || printIndent();
            print('})');
            break;
            break;

        case 'nop':
            // No-ops don't do anything.  I'm assuming they never trigger any behavior by
            // "seperating" adjacent statements.
            break;

        default:
            throw new Error('Unknown statement type: "' + astNode.type + '"');
    }
    // Statements are terminated by a semicolon and a newline
    // except for a few exceptions.
    // Also, in certain contexts we want to omit this termination
    // (e.g., initializer statement of a for loop)
    if(!_.contains(['nop', 'statements'], astNode.type) && !omitTerminator) {
        print(';\n');
    }
};

var generateCase = function(astNode) {
    switch(astNode.type) {

        case 'case':
            printIndent();
            print('case (');
            generateExpression(astNode.expr);
            print('):\n');
            indent();
            generateStatement(astNode.stmts);
            outdent();
            break;

        case 'defaultcase':
            printIndent();
            print('default:\n');
            indent();
            generateStatement(astNode.stmts);
            outdent();
            break;

        default:
            throw new Error('Unknown case type: "' + astNode.type + '"');
    }
};

var generateLocalVariableAllocation = function(astNode) {
    var localVariables = _.filter(astUtils.getAnglScope(astNode).getVariablesArray(), function(variable) {
        return variable.getAllocationType() === 'LOCAL';
    });
    if(localVariables.length) {
        printIndent();
        print('var ');
        print(_.map(localVariables, function(variable) {
            return variable.getJsIdentifier();
        }).join(', '));
        print(';\n');
    }
}

var generateTopNode = function(astNode) {
    switch(astNode.type) {

        case 'file':
            // RequireJS `define()` call
            print('define(function(require) {\n');
            indent();
            printIndent();
            // Something removes "use strict" from the source code unless I split it up like so.  RequireJS perhaps?
            print('"use' + ' strict";\n');
            // require modules
            printIndent();
            print('var ' + strings.ANGL_GLOBALS_IDENTIFIER + ' = require(' + JSON.stringify(strings.ANGL_GLOBALS_MODULE) + ');\n');
            printIndent();
            print('var ' + strings.ANGL_RUNTIME_IDENTIFIER + ' = require(' + JSON.stringify(strings.ANGL_RUNTIME_MODULE) + ');\n');
            // allocate local variables
            generateLocalVariableAllocation(astNode);
            // delegate to the statement generator
            _.each(astNode.stmts, function(node) {
                generateStatement(node);
            });
            outdent();
            print('});');
            break;

        default:
            throw new Error('Unknown root node type: "' + astNode.type + '"');
    }
};

module.exports.generateJs = function(transformedAst) {
    initializeCompiler();
    generateTopNode(transformedAst);
    return _.flatten(buffer).join('');
};

