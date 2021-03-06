var _ = require('lodash');
import scope = module('./angl-scope');
import scopeVariable = module('./scope-variable');
import strings = module('./strings');
var anglGlobalsNamespace = require('../../runtime/src/angl-globals-namespace');
// Trigger loading of all globals onto the globals namespace
require('../../runtime/src/angl-globals');


export function createGlobalScope(extraGlobalIdentifiers?:string[] = []):scope.AnglScope {
    var globalScope = new scope.AnglScope();

    // Grab the list of all global identifiers from the runtime
    var globalIdentifiers:any = _.keys(anglGlobalsNamespace);
    
    // Add any user-supplied global identifiers
    globalIdentifiers = globalIdentifiers.concat(extraGlobalIdentifiers);
    
    // Add all global identifiers into global scope
    _.each(globalIdentifiers, (globalIdentifier) => {
        // TODO what values should I be adding?  Gotta invent an object/type/schema for values.
        var variable = new scopeVariable.Variable(globalIdentifier, 'PROP_ASSIGNMENT', 'PROP_ACCESS');
        variable.setContainingObjectIdentifier(strings.ANGL_GLOBALS_IDENTIFIER);
        globalScope.addVariable(variable);
    });

    return globalScope;
};

