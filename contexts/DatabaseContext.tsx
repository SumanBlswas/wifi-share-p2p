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
            isOnline INTEGER DEFAULT 0
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
