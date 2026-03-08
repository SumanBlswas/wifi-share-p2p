import { useAuth } from '@/contexts/AuthContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    FlatList,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function ChatScreen() {
    const router = useRouter();
    const { userId } = useAuth();
    const { db } = useDatabase();
    const [search, setSearch] = useState('');
    const [chats, setChats] = useState<any[]>([]);

    useEffect(() => {
        if (!db || !userId) return;

        const fetchChats = async () => {
            try {
                // Advanced query to get unique conversations with last message
                const query = `
                    SELECT 
                        peerId,
                        c.name,
                        m.content as lastMsg,
                        m.timestamp,
                        0 as unread
                    FROM (
                        SELECT 
                            CASE WHEN senderId = ? THEN receiverId ELSE senderId END as peerId,
                            content,
                            timestamp
                        FROM messages
                        WHERE senderId = ? OR receiverId = ?
                        ORDER BY timestamp DESC
                    ) m
                    LEFT JOIN contacts c ON c.id = m.peerId
                    GROUP BY peerId
                    ORDER BY timestamp DESC
                `;
                const results = await db.getAllAsync(query, [userId, userId, userId]);
                setChats(results);
            } catch (e) {
                console.error("Failed to fetch chats", e);
            }
        };

        fetchChats();
        const interval = setInterval(fetchChats, 2000); // Polling for updates
        return () => clearInterval(interval);
    }, [db, userId]);

    const filteredChats = chats.filter(chat =>
        (chat.name || 'Unknown').toLowerCase().includes(search.toLowerCase()) ||
        chat.lastMsg.toLowerCase().includes(search.toLowerCase())
    );

    const renderItem = ({ item, index }: { item: any, index: number }) => (
        <Animated.View entering={FadeInDown.delay(index * 50).springify()}>
            <TouchableOpacity
                style={styles.card}
                activeOpacity={0.7}
                onPress={() => router.push({ pathname: '/conversation/[id]', params: { id: item.peerId, name: item.name } })}
            >
                <View style={[styles.avatar, { backgroundColor: index % 2 === 0 ? '#EFF6FF' : '#F5F3FF' }]}>
                    <Text style={[styles.avatarText, { color: index % 2 === 0 ? '#3B82F6' : '#8B5CF6' }]}>
                        {(item.name || 'U').charAt(0)}
                    </Text>
                    {item.unread > 0 && <View style={styles.unreadBadge} />}
                </View>
                <View style={styles.info}>
                    <View style={styles.row}>
                        <Text style={styles.name}>{item.name || 'Unknown Peer'}</Text>
                        <Text style={styles.time}>
                            {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                    </View>
                    <Text style={styles.lastMsg} numberOfLines={1}>{item.lastMsg}</Text>
                </View>
            </TouchableOpacity>
        </Animated.View>
    );

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>Messages</Text>
                <TouchableOpacity style={styles.newBtn} onPress={() => router.push('/nexus')}>
                    <Ionicons name="create-outline" size={24} color="#3B82F6" />
                </TouchableOpacity>
            </View>

            <View style={styles.searchContainer}>
                <Ionicons name="search-outline" size={20} color="#94A3B8" style={styles.searchIcon} />
                <TextInput
                    style={styles.searchInput}
                    placeholder="Search conversations..."
                    placeholderTextColor="#94A3B8"
                    value={search}
                    onChangeText={setSearch}
                />
            </View>

            <FlatList
                data={filteredChats}
                keyExtractor={(item) => item.peerId}
                renderItem={renderItem}
                ListEmptyComponent={() => (
                    <View style={styles.empty}>
                        <Ionicons name="chatbubbles-outline" size={80} color="#E2E8F0" />
                        <Text style={styles.emptyText}>{chats.length === 0 ? "No conversations yet." : "No results found."}</Text>
                        <Text style={styles.emptySub}>Start a P2P chat via the Nexus tab by choosing a contact.</Text>
                    </View>
                )}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
            />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F8FAFC',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 24,
        paddingTop: 10,
        paddingBottom: 20,
    },
    title: {
        fontSize: 34,
        fontWeight: '900',
        color: '#0F172A',
        letterSpacing: -0.5,
    },
    newBtn: {
        width: 44,
        height: 44,
        borderRadius: 14,
        backgroundColor: '#FFFFFF',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOpacity: 0.05,
        shadowRadius: 10,
        elevation: 2,
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        marginHorizontal: 24,
        paddingHorizontal: 16,
        height: 52,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#F1F5F9',
        marginBottom: 20,
    },
    searchIcon: {
        marginRight: 10,
    },
    searchInput: {
        flex: 1,
        fontSize: 16,
        color: '#1E293B',
    },
    listContent: {
        paddingHorizontal: 24,
        paddingBottom: 120,
    },
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#F8FAFC',
        shadowColor: '#000',
        shadowOpacity: 0.02,
        shadowRadius: 10,
        elevation: 1,
    },
    avatar: {
        width: 56,
        height: 56,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 16,
    },
    avatarText: {
        fontSize: 20,
        fontWeight: '800',
    },
    unreadBadge: {
        position: 'absolute',
        top: -4,
        right: -4,
        width: 14,
        height: 14,
        borderRadius: 7,
        backgroundColor: '#10B981',
        borderWidth: 2,
        borderColor: '#FFFFFF',
    },
    info: {
        flex: 1,
    },
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4,
    },
    name: {
        fontSize: 17,
        fontWeight: '700',
        color: '#1E293B',
    },
    time: {
        fontSize: 12,
        color: '#94A3B8',
        fontWeight: '500',
    },
    lastMsg: {
        fontSize: 14,
        color: '#64748B',
        lineHeight: 20,
    },
    empty: {
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 100,
    },
    emptyText: {
        fontSize: 18,
        fontWeight: '700',
        color: '#475569',
        marginTop: 16,
    },
    emptySub: {
        fontSize: 14,
        color: '#94A3B8',
        marginTop: 8,
        textAlign: 'center',
        paddingHorizontal: 40,
    },
});
