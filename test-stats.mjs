import { getDatabaseStats, initDatabase } from './dist/memory/index.js';
initDatabase();
const stats = getDatabaseStats();
console.log('Type:', typeof stats);
console.log('Stats:', JSON.stringify(stats, null, 2));
