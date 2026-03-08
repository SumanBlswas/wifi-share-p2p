import * as SQLite from 'expo-sqlite';
import React, { createContext, useContext, useEffect, useState } from 'react';

type DBContextType = {
  db: SQLite.SQLiteDatabase | null;
  isReady: boolean;
};

const DatabaseContext = createContext<DBContextType>({ db: null, isReady: false });

export function useDatabase() {
  return useContext(DatabaseContext);
}

export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<SQLite.SQLiteDatabase | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    async function setupDatabase() {
      try {
        const database = await SQLite.openDatabaseAsync('p2p_nexus.db');

        // Initialize tables: Users (contacts), Messages, Files
        await database.execAsync(`
          PRAGMA journal_mode = WAL;
          CREATE TABLE IF NOT EXISTS contacts (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            phone TEXT NOT NULL,
            avatarUri TEXT,
            isOnline INTEGER DEFAULT 0,
            isSaved INTEGER DEFAULT 0
          );
          CREATE TABLE IF NOT EXISTS call_history (
            id TEXT PRIMARY KEY NOT NULL,
            peerId TEXT NOT NULL,
            peerName TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            type TEXT NOT NULL,
            direction TEXT NOT NULL,
            status TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY NOT NULL,
            senderId TEXT NOT NULL,
            receiverId TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            type TEXT DEFAULT 'text',
            status TEXT DEFAULT 'sent'
          );
          CREATE TABLE IF NOT EXISTS files (
            id TEXT PRIMARY KEY NOT NULL,
            localUri TEXT NOT NULL,
            name TEXT NOT NULL,
            size INTEGER NOT NULL,
            mimeType TEXT
          );
          CREATE TABLE IF NOT EXISTS groups (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            avatarUri TEXT,
            timestamp INTEGER NOT NULL
          );
          CREATE TABLE IF NOT EXISTS group_members (
            groupId TEXT NOT NULL,
            contactId TEXT NOT NULL,
            PRIMARY KEY (groupId, contactId)
          );
        `);

        // MIGRATIONS
        try {
          // Check if isSaved column exists
          const tableInfo: any[] = await database.getAllAsync("PRAGMA table_info(contacts)");
          const hasIsSaved = tableInfo.some(col => col.name === 'isSaved');
          if (!hasIsSaved) {
            console.log("[DB] Migrating: Adding isSaved to contacts...");
            await database.execAsync("ALTER TABLE contacts ADD COLUMN isSaved INTEGER DEFAULT 0");
          }
        } catch (migError) {
          console.warn("[DB] Migration failed (likely already migrated):", migError);
        }

        setDb(database);
      } catch (e) {
        console.error("Failed to initialize SQLite database", e);
      } finally {
        setIsReady(true);
      }
    }

    setupDatabase();
  }, []);

  if (!isReady) {
    // Optionally return a loading spinner or keep Splash Screen visible
    return null;
  }

  return (
    <DatabaseContext.Provider value={{ db, isReady }}>
      {children}
    </DatabaseContext.Provider>
  );
}
