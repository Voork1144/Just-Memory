#!/usr/bin/env python
"""Database migration script for Just-Memory v2.1 - Full migration"""
import sqlite3

DB_PATH = r"C:\Users\ericc\.just-memory\memories.db"

def migrate():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # Get all tables
    c.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [t[0] for t in c.fetchall()]
    print(f"Tables: {tables}")
    
    # All tables that need project_id
    tables_needing_project_id = [
        'memories', 
        'entities', 
        'edges', 
        'scratchpad',
        'entity_relations'
    ]
    
    for table in tables_needing_project_id:
        if table in tables:
            c.execute(f"PRAGMA table_info({table})")
            cols = [col[1] for col in c.fetchall()]
            
            if 'project_id' not in cols:
                print(f"Adding project_id to {table}...")
                c.execute(f"ALTER TABLE {table} ADD COLUMN project_id TEXT DEFAULT 'global'")
                conn.commit()
                print("  Done!")
            else:
                print(f"{table}: project_id exists")
        else:
            print(f"{table}: table does not exist (will be created on first run)")
    
    conn.close()
    print("\nAll migrations complete!")

if __name__ == "__main__":
    migrate()
