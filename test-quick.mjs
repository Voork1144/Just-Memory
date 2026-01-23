import { initDatabase, getDatabaseStats } from './dist/memory/database.js';

console.log('Initializing database...');
const db = initDatabase();
console.log('Getting stats...');
const stats = getDatabaseStats();
console.log('Stats type:', typeof stats);
console.log('Stats:', JSON.stringify(stats, null, 2));
console.log('Done');
