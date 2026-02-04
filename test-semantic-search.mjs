/**
 * Quick test for semantic search functionality
 */
import { initDatabase } from './dist/memory/database.js';
import { initEmbeddings, getEmbeddingsStatus } from './dist/memory/embeddings.js';
import { storeMemory } from './dist/memory/crud.js';
import { searchMemories } from './dist/memory/search.js';

async function main() {
  console.log('1. Initializing database...');
  const db = initDatabase();
  console.log('   Database initialized');
  
  console.log('\n2. Initializing embeddings...');
  try {
    await initEmbeddings();
    const status = getEmbeddingsStatus();
    console.log('   Embeddings status:', status);
  } catch (err) {
    console.error('   Embeddings error:', err.message);
    return;
  }
  
  console.log('\n3. Storing test memories...');
  const memories = [
    { content: 'The quick brown fox jumps over the lazy dog', type: 'fact' },
    { content: 'Python is a popular programming language for machine learning', type: 'fact' },
    { content: 'JavaScript runs in web browsers and Node.js', type: 'fact' },
    { content: 'Cats are furry animals that love to sleep', type: 'fact' },
    { content: 'TypeScript adds static types to JavaScript', type: 'fact' },
  ];
  
  for (const mem of memories) {
    const stored = await storeMemory(mem);
    console.log(`   Stored: "${stored.content.slice(0, 40)}..."`);
  }
  
  console.log('\n4. Testing BM25 search (keyword)...');
  const bm25Results = await searchMemories('programming language', { mode: 'bm25', limit: 3 });
  console.log(`   Found ${bm25Results.length} results:`);
  for (const r of bm25Results) {
    console.log(`   - [${r.score.toFixed(2)}] ${r.snippet.slice(0, 50)}...`);
  }
  
  console.log('\n5. Testing VECTOR search (semantic)...');
  const vectorResults = await searchMemories('coding software development', { mode: 'vector', limit: 3 });
  console.log(`   Found ${vectorResults.length} results:`);
  for (const r of vectorResults) {
    console.log(`   - [${r.score.toFixed(2)}] ${r.snippet.slice(0, 50)}...`);
  }
  
  console.log('\n6. Testing HYBRID search...');
  const hybridResults = await searchMemories('animals pets', { mode: 'hybrid', limit: 3 });
  console.log(`   Found ${hybridResults.length} results:`);
  for (const r of hybridResults) {
    console.log(`   - [${r.score.toFixed(2)}] ${r.snippet.slice(0, 50)}...`);
  }
  
  console.log('\n✅ All semantic search tests completed!');
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
