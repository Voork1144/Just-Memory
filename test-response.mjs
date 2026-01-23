// Test the exact response structure
import { initDatabase, getDatabaseStats } from './dist/memory/database.js';

console.log('Testing memory_stats response...');
initDatabase();
const stats = getDatabaseStats();

// Simulate what the server does
const result = stats;
let textResult;
if (typeof result === 'string') {
  textResult = result;
} else if (result === undefined || result === null) {
  textResult = 'null';
} else {
  textResult = JSON.stringify(result, null, 2);
}

const response = {
  content: [{
    type: 'text',
    text: textResult,
  }],
};

console.log('Response structure:');
console.log(JSON.stringify(response, null, 2));
console.log('');
console.log('content[0].type:', typeof response.content[0].type, '=', response.content[0].type);
console.log('content[0].text:', typeof response.content[0].text, '(length:', response.content[0].text.length, ')');
