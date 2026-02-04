import sqlite3
import os

db_path = os.path.expanduser("~/.just-memory/memories.db")
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Get all tables
cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = cursor.fetchall()
print("Tables:", [t[0] for t in tables])

# Get schema for each table
for table in tables:
    cursor.execute(f"PRAGMA table_info({table[0]})")
    columns = cursor.fetchall()
    print(f"\n{table[0]}:")
    for col in columns:
        print(f"  {col[1]}: {col[2]} (nullable={col[3]==0}, default={col[4]})")

# Count memories
cursor.execute("SELECT COUNT(*) FROM memories")
print(f"\nTotal memories: {cursor.fetchone()[0]}")

conn.close()
