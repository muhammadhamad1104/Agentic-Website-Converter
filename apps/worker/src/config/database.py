"""
PostgreSQL Database Configuration for Python Agent
Uses psycopg2 for direct PostgreSQL connection with connection pooling
"""

import os
from contextlib import contextmanager
import psycopg2
from psycopg2 import pool
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()

# Database connection pool
db_pool = None

def init_db_pool():
    """Initialize database connection pool"""
    global db_pool
    
    if db_pool is None:
        try:
            db_pool = psycopg2.pool.ThreadedConnectionPool(
                minconn=2,  # Minimum connections
                maxconn=10,  # Maximum connections
                dsn=os.getenv('DATABASE_URL'),
                cursor_factory=RealDictCursor,  # Return dict instead of tuples
            )
            print("✅ PostgreSQL connection pool initialized")
        except Exception as e:
            print(f"❌ Failed to initialize database pool: {e}")
            raise

def get_db_pool():
    """Get the database connection pool"""
    global db_pool
    if db_pool is None:
        init_db_pool()
    return db_pool

@contextmanager
def get_db_connection():
    """
    Context manager for database connections
    Automatically returns connection to pool after use
    
    Usage:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM users")
                results = cur.fetchall()
    """
    pool = get_db_pool()
    conn = None
    try:
        conn = pool.getconn()
        yield conn
    except Exception as e:
        if conn:
            conn.rollback()
        raise e
    finally:
        if conn:
            pool.putconn(conn)

@contextmanager
def get_db_cursor(commit=True):
    """
    Context manager for database cursor
    Automatically commits (if specified) and closes cursor
    
    Usage:
        with get_db_cursor() as cur:
            cur.execute("INSERT INTO users (name) VALUES (%s)", ("John",))
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        try:
            yield cursor
            if commit:
                conn.commit()
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            cursor.close()

async def check_database_health():
    """Health check for database connection"""
    try:
        with get_db_cursor(commit=False) as cur:
            cur.execute("SELECT 1")
            result = cur.fetchone()
            return {
                "status": "healthy",
                "database": "postgresql",
                "test_query": result is not None
            }
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e)
        }

def close_db_pool():
    """Close all database connections"""
    global db_pool
    if db_pool:
        db_pool.closeall()
        print("✅ PostgreSQL connection pool closed")

# Initialize pool on import
init_db_pool()
