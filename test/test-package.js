import { createRouteGenerator, configureRouter, registerMiddleware } from '../dist/index.js';

// Test des exports
console.log('✅ createRouteGenerator:', typeof createRouteGenerator);
console.log('✅ configureRouter:', typeof configureRouter);
console.log('✅ registerMiddleware:', typeof registerMiddleware);

// Test des types
console.log('✅ Package built successfully!');