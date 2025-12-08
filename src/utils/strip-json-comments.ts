/**
 * Remove comments from JSON string
 */
export function stripJsonComments(jsonString: string): string {
  // Remove single-line comments (// ...)
  jsonString = jsonString.replace(/\/\/.*$/gm, '');
  // Remove multi-line comments (/* ... */)
  jsonString = jsonString.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove trailing commas before closing brackets/braces
  jsonString = jsonString.replace(/,(\s*[}\]])/g, '$1');
  return jsonString;
}