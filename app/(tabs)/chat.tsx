import { useAuth } from '@/contexts/AuthContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import { GlobalSigClient } from '@/services/GlobalSigClient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type Tab = 'messages' | 'history';

const normalizePhone = (num: string) => {
    if (!num) return '';
    if (num.length > 15 || /[a-zA-Z]/.test(num)) return num;
    let cleaned = num.replace(/[^\d+]/g, '');
    if (cleaned.startsWith('0')) cleaned = cleaned.substring(1);
    if (cleaned.startsWith('91') && cleaned.length > 10) cleaned = cleaned.substring(2);
    else if (cleaned.startsWith('+91')) cleaned = cleaned.substring(3);
    return cleaned;
};

export default function ChatScreen() {
    const router = useRouter();
    const { userId } = useAuth();
    const { db } = useDatabase();

    const [activeTab, setActiveTab] = useState<Tab>('messages');
    const [search, setSearch] = useState('');
    const [conversations, setConversations] = useState<any[]>([]);
    const [callHistory, setCallHistory] = useState<any[]>([]);
    const [onlinePeers, setOnlinePeers] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Fetch data from local SQLite
    const fetchData = async () => {
        if (!db) return;
        setIsLoading(true);

        try {
            // Fetch Conversations + Saved Peers WITHOUT messages (if they were discovered)
            const chatData: any[] = await db.getAllAsync(`
                SELECT 
                    m.senderId,
                    m.receiverId,
                    m.content as lastMsg,
                    m.timestamp,
                    c.name as peerName,
                    c.id as contactId,
                    c.name as contactName
                FROM contacts c
                LEFT JOIN messages m ON (m.senderId = c.id OR m.receiverId = c.id)
                WHERE (m.senderId = ? OR m.receiverId = ? OR c.isSaved = 1)
                GROUP BY c.id
                ORDER BY CASE WHEN m.timestamp IS NULL THEN 0 ELSE 1 END DESC, m.timestamp DESC
            `, [userId, userId]);

            // Post-process: prioritize conversations, but show saved peers fallback
            const processedChats = chatData.map(chat => {
                const isMsg = !!chat.timestamp;
                const peerId = chat.contactId;
                const name = chat.contactName || chat.peerName || `Peer ${peerId.substring(0, 5)}...`;

                return {
                    ...chat,
                    peerId,
                    name,
                    lastMsg: chat.lastMsg || 'No messages yet (Found online)',
                    time: chat.timestamp ? new Date(chat.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Saved',
                };
            });
            setConversations(processedChats);

            // Fetch Call History
            const calls: any[] = await db.getAllAsync(`
                SELECT * FROM call_history ORDER BY timestamp DESC LIMIT 50
            `);
            setCallHistory(calls.map(c => ({
                ...c,
                time: new Date(c.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
            })));

        } catch (e) {
            console.error('[Chat] DB Load Error:', e);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchData();

        // Listen for new discovered peers (like Nexus tab)
        const handlePeerIdentified = async (peer: any) => {
            if (userId && normalizePhone(peer.id) === normalizePhone(userId)) return;

            // AUTO-SAVE to DB
            if (db) {
                try {
                    await db.runAsync(
                        'INSERT OR REPLACE INTO contacts (id, name, phone, isSaved) VALUES (?, ?, ?, ?)',
                        [peer.id, peer.name, peer.phone || peer.id, 1]
                    );
                    // Refresh main list to show the newly saved peer
                    fetchData();
                } catch (e) {
                    console.warn('[DB] Peer auto-save failed:', e);
                }
            }

            setOnlinePeers(prev => {
                const exists = prev.find(p => p.id === peer.id);
                if (exists) return prev;
                return [...prev, { ...peer, identifiedAt: Date.now() }];
            });
        };

        GlobalSigClient.on('peer_identified', handlePeerIdentified);
        GlobalSigClient.refreshPeers();

        return () => {
            GlobalSigClient.off('peer_identified', handlePeerIdentified);
        };
    }, [userId, db]);

    const saveDiscoveredPeer = async (peer: any) => {
        if (!db) return;
        try {
            await db.runAsync(
                'INSERT OR REPLACE INTO contacts (id, name, phone, isSaved) VALUES (?, ?, ?, ?)',
                [peer.id, peer.name, peer.phone || peer.id, 1]
            );
            // Optionally remove from horizontal list once saved? Or keep it.
            console.log('[Chat] Peer saved to contacts');
        } catch (e) {
            console.warn('[DB] Save peer error:', e);
        }
    };

    const filteredConversations = conversations.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.lastMsg.toLowerCase().includes(search.toLowerCase())
    );

    const filteredHistory = callHistory.filter(h =>
        h.peerName.toLowerCase().includes(search.toLowerCase()) ||
        h.peerId.includes(search)
    );

    const renderChatItem = ({ item }: { item: any }) => (
        <TouchableOpacity
            style={styles.card}
            activeOpacity={0.7}
            onPress={() => router.push({ pathname: '/conversation/[id]', params: { id: item.peerId, name: item.name } })}
        >
            <View style={styles.avatar}>
                <Text style={styles.avatarText}>{item.name[0]}</Text>
            </View>
            <View style={styles.info}>
                <View style={styles.row}>
                    <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.time}>{item.time}</Text>
                </View>
                <Text style={styles.lastMsg} numberOfLines={1}>{item.lastMsg}</Text>
            </View>
        </TouchableOpacity>
    );

    const renderHistoryItem = ({ item }: { item: any }) => (
        <TouchableOpacity
            style={styles.card}
            activeOpacity={0.7}
            onPress={() => router.push({
                pathname: '/call',
                params: { type: 'outgoing', peerId: item.peerId, peerName: item.peerName, callType: item.type }
            })}
        >
            <View style={[styles.avatar, { backgroundColor: item.direction === 'incoming' ? '#F0F9FF' : '#FDF2F2' }]}>
                <Ionicons
                    name={item.direction === 'incoming' ? "call-outline" : "arrow-up-outline"}
                    size={20}
                    color={item.direction === 'incoming' ? "#3B82F6" : "#EF4444"}
                />
            </View>
            <View style={styles.info}>
                <View style={styles.row}>
                    <Text style={styles.name}>{item.peerName}</Text>
                    <Text style={styles.time}>{item.time}</Text>
                </View>
                <View style={styles.row}>
                    <Text style={[styles.lastMsg, { color: item.status === 'missed' ? '#EF4444' : '#64748B' }]}>
                        {item.type === 'video' ? 'Video' : 'Audio'} • {item.status.toUpperCase()}
                    </Text>
                    <Ionicons name={item.type === 'video' ? "videocam" : "call"} size={16} color="#94A3B8" />
                </View>
            </View>
        </TouchableOpacity>
    );

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>Inbox</Text>
                <View style={styles.tabContainer}>
                    <TouchableOpacity
                        style={[styles.tab, activeTab === 'messages' && styles.activeTab]}
                        onPress={() => setActiveTab('messages')}
                    >
                        <Text style={[styles.tabText, activeTab === 'messages' && styles.activeTabText]}>Messages</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.tab, activeTab === 'history' && styles.activeTab]}
                        onPress={() => setActiveTab('history')}
                    >
                        <Text style={[styles.tabText, activeTab === 'history' && styles.activeTabText]}>History</Text>
                    </TouchableOpacity>
                </View>
            </View>

            <View style={styles.searchContainer}>
                <Ionicons name="search-outline" size={20} color="#94A3B8" style={styles.searchIcon} />
                <TextInput
                    style={styles.searchInput}
                    placeholder={`Search ${activeTab}...`}
                    placeholderTextColor="#94A3B8"
                    value={search}
                    onChangeText={setSearch}
                />
            </View>

            {/* DISCOVERED PEERS (PILLS) */}
            {onlinePeers.length > 0 && (
                <View style={styles.discoverySection}>
                    <Text style={styles.sectionLabel}>AVAILABLE TO CONNECT</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.discoveryList}>
                        {onlinePeers.map((peer, idx) => (
                            <View key={peer.id || idx} style={styles.peerPill}>
                                <TouchableOpacity
                                    style={styles.pillMain}
                                    onPress={() => router.push({ pathname: '/conversation/[id]', params: { id: peer.id, name: peer.name } })}
                                >
                                    <View style={styles.pillAvatar}>
                                        <Text style={styles.pillAvatarText}>{peer.name[0]}</Text>
                                        <View style={styles.onlineDot} />
                                    </View>
                                    <Text style={styles.pillName} numberOfLines={1}>{peer.name.split(' ')[0]}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={styles.pillSave}
                                    onPress={() => saveDiscoveredPeer(peer)}
                                >
                                    <Ionicons name="bookmark-outline" size={14} color="#3B82F6" />
                                </TouchableOpacity>
                            </View>
                        ))}
                    </ScrollView>
                </View>
            )}

            {isLoading ? (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    <ActivityIndicator size="large" color="#3B82F6" />
                </View>
            ) : (
                <FlatList
                    data={activeTab === 'messages' ? filteredConversations : filteredHistory}
                    renderItem={activeTab === 'messages' ? renderChatItem : renderHistoryItem}
                    keyExtractor={(item) => item.id || (item.peerId + item.timestamp).toString()}
                    onRefresh={fetchData}
                    refreshing={false}
                    ListEmptyComponent={() => (
                        <View style={styles.empty}>
                            <Ionicons
                                name={activeTab === 'messages' ? "chatbubbles-outline" : "call-outline"}
                                size={80}
                                color="#E2E8F0"
                            />
                            <Text style={styles.emptyText}>No {activeTab} yet.</Text>
                            <Text style={styles.emptySub}>
                                {activeTab === 'messages'
                                    ? "Start a P2P chat via the Nexus tab or search."
                                    : "Recent calls will appear here."}
                            </Text>
                        </View>
                    )}
                    contentContainerStyle={styles.listContent}
                />
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F8FAFC',
    },
    header: {
        paddingHorizontal: 24,
        paddingTop: 10,
        paddingBottom: 15,
    },
    title: {
        fontSize: 34,
        fontWeight: '900',
        color: '#0F172A',
        marginBottom: 15,
    },
    tabContainer: {
        flexDirection: 'row',
        backgroundColor: '#F1F5F9',
        padding: 4,
        borderRadius: 14,
    },
    tab: {
        flex: 1,
        paddingVertical: 10,
        alignItems: 'center',
        borderRadius: 10,
    },
    activeTab: {
        backgroundColor: '#FFFFFF',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 3,
    },
    tabText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#64748B',
    },
    activeTabText: {
        color: '#3B82F6',
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
        borderColor: '#E2E8F0',
        marginBottom: 10,
    },
    searchIcon: {
        marginRight: 10,
    },
    searchInput: {
        flex: 1,
        fontSize: 16,
        color: '#1E293B',
    },
    discoverySection: {
        marginTop: 10,
        marginBottom: 20,
    },
    sectionLabel: {
        fontSize: 11,
        fontWeight: '800',
        color: '#94A3B8',
        letterSpacing: 1,
        marginLeft: 24,
        marginBottom: 12,
    },
    discoveryList: {
        paddingLeft: 24,
        paddingRight: 10,
    },
    peerPill: {
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        padding: 8,
        marginRight: 12,
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#E2E8F0',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.03,
        shadowRadius: 2,
    },
    pillMain: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    pillAvatar: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#EFF6FF',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 8,
    },
    pillAvatarText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#3B82F6',
    },
    onlineDot: {
        position: 'absolute',
        bottom: 0,
        right: 0,
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: '#4ADE80',
        borderWidth: 2,
        borderColor: '#FFFFFF',
    },
    pillName: {
        fontSize: 13,
        fontWeight: '700',
        color: '#1E293B',
        marginRight: 8,
    },
    pillSave: {
        padding: 6,
        backgroundColor: '#F0F9FF',
        borderRadius: 12,
    },
    listContent: {
        paddingHorizontal: 24,
        paddingBottom: 100,
    },
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#F1F5F9',
    },
    avatar: {
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: '#EFF6FF',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 16,
    },
    avatarText: {
        fontSize: 20,
        fontWeight: '700',
        color: '#3B82F6',
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
        flex: 1,
        marginRight: 8,
    },
    time: {
        fontSize: 12,
        color: '#94A3B8',
    },
    lastMsg: {
        fontSize: 15,
        color: '#64748B',
    },
    empty: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 60,
    },
    emptyText: {
        fontSize: 18,
        fontWeight: '700',
        color: '#94A3B8',
        marginTop: 20,
    },
    emptySub: {
        fontSize: 14,
        color: '#CBD5E1',
        marginTop: 8,
        textAlign: 'center',
        paddingHorizontal: 40,
    }
});
