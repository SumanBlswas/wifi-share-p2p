import { useAuth } from '@/contexts/AuthContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import { useWebRTC } from '@/contexts/WebRTCContext';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
    FlatList,
    KeyboardAvoidingView,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function ConversationScreen() {
    const { id: peerId, name: paramName, peerIp } = useLocalSearchParams<{ id: string, name?: string, peerIp?: string }>();
    const router = useRouter();
    const { userId } = useAuth();
    const { db } = useDatabase();
    const { sendMessage } = useWebRTC();

    const [messages, setMessages] = useState<any[]>([]);
    const [inputText, setInputText] = useState('');
    const [peerName, setPeerName] = useState(paramName || 'Chat');
    const flatListRef = useRef<FlatList>(null);

    useEffect(() => {
        if (paramName) setPeerName(paramName);
    }, [paramName]);

    useEffect(() => {
        if (!db || !peerId) return;

        // Fetch peer name
        const fetchPeer = async () => {
            const result = await db.getAllAsync('SELECT name FROM contacts WHERE id = ?', [peerId]);
            if (result.length > 0) {
                const name = (result[0] as any).name;
                if (name && name !== 'Chat' && name !== 'Unknown Peer') {
                    setPeerName(name);
                }
            }

            // If we have a param name, ensure it's in the DB
            if (paramName && paramName !== 'Chat' && paramName !== 'Unknown Peer') {
                await db.runAsync(
                    'INSERT OR REPLACE INTO contacts (id, name, phone) VALUES (?, ?, ?)',
                    [peerId!, paramName, peerId!]
                );
            }
        };

        // Fetch existing messages
        const fetchMessages = async () => {
            const results = await db.getAllAsync(
                'SELECT * FROM messages WHERE (senderId = ? AND receiverId = ?) OR (senderId = ? AND receiverId = ?) ORDER BY timestamp ASC',
                [userId, peerId, peerId, userId]
            );
            setMessages(results);
        };

        fetchPeer();
        fetchMessages();

        // Optional: Polling or listener for new messages
        const interval = setInterval(fetchMessages, 1000);
        return () => clearInterval(interval);
    }, [db, peerId, userId]);

    const handleSend = async () => {
        if (!inputText.trim() || !peerId) return;

        const sent = await sendMessage(peerId, inputText.trim());

        // Save to local DB regardless (or only if sent? for P2P we usually save and show as "sending")
        const msgId = Math.random().toString(36).substring(7);
        const timestamp = Date.now();

        await db?.runAsync(
            'INSERT INTO messages (id, senderId, receiverId, content, timestamp, type, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [msgId, userId!, peerId, inputText.trim(), timestamp, 'text', sent ? 'sent' : 'pending']
        );

        // Ensure recipient exists in contacts so Chat list can show them
        await db?.runAsync(
            'INSERT OR REPLACE INTO contacts (id, name, phone) VALUES (?, ?, ?)',
            [peerId, peerName, peerId]
        );

        setInputText('');
        // Refresh local messages
        const results = await db?.getAllAsync(
            'SELECT * FROM messages WHERE (senderId = ? AND receiverId = ?) OR (senderId = ? AND receiverId = ?) ORDER BY timestamp ASC',
            [userId, peerId, peerId, userId]
        );
        if (results) setMessages(results);
    };

    const renderItem = ({ item }: { item: any }) => {
        const isMe = item.senderId === userId;
        return (
            <View style={[styles.messageContainer, isMe ? styles.myMessage : styles.theirMessage]}>
                <View style={[styles.bubble, isMe ? styles.myBubble : styles.theirBubble]}>
                    <Text style={[styles.messageText, isMe ? styles.myText : styles.theirText]}>
                        {item.content}
                    </Text>
                </View>
                <Text style={styles.timestamp}>
                    {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
            </View>
        );
    };

    return (
        <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={28} color="#3B82F6" />
                </TouchableOpacity>
                <View style={styles.headerInfo}>
                    <View style={styles.avatar}>
                        <Text style={styles.avatarText}>{peerName.charAt(0)}</Text>
                    </View>
                    <Text style={styles.headerName}>{peerName}</Text>
                </View>
                <View style={{ flexDirection: 'row' }}>
                    <TouchableOpacity style={styles.callBtn} onPress={() => router.push({ pathname: '/call', params: { peerId, peerName, type: 'outgoing', callType: 'audio' } })}>
                        <Ionicons name="call" size={24} color="#3B82F6" />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.callBtn} onPress={() => router.push({ pathname: '/call', params: { peerId, peerName, type: 'outgoing', callType: 'video' } })}>
                        <Ionicons name="videocam" size={24} color="#3B82F6" />
                    </TouchableOpacity>
                </View>
            </View>

            <FlatList
                ref={flatListRef}
                data={messages}
                keyExtractor={(item) => item.id}
                renderItem={renderItem}
                contentContainerStyle={styles.listContent}
                onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
            />

            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
            >
                <View style={styles.inputContainer}>
                    <TouchableOpacity style={styles.attachBtn}>
                        <Ionicons name="add" size={24} color="#94A3B8" />
                    </TouchableOpacity>
                    <TextInput
                        style={styles.input}
                        placeholder="Type a message..."
                        value={inputText}
                        onChangeText={setInputText}
                        multiline
                    />
                    <TouchableOpacity
                        style={[styles.sendBtn, !inputText.trim() && { opacity: 0.5 }]}
                        onPress={handleSend}
                        disabled={!inputText.trim()}
                    >
                        <Ionicons name="send" size={20} color="#FFFFFF" />
                    </TouchableOpacity>
                </View>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#FFFFFF' },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#F1F5F9',
    },
    backBtn: { padding: 4 },
    headerInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', marginLeft: 8 },
    avatar: { width: 40, height: 40, borderRadius: 14, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
    avatarText: { color: '#3B82F6', fontWeight: '800', fontSize: 16 },
    headerName: { fontSize: 18, fontWeight: '700', color: '#1E293B' },
    callBtn: { padding: 8 },
    listContent: { paddingHorizontal: 16, paddingVertical: 20 },
    messageContainer: { marginBottom: 16, maxWidth: '80%' },
    myMessage: { alignSelf: 'flex-end' },
    theirMessage: { alignSelf: 'flex-start' },
    bubble: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20 },
    myBubble: { backgroundColor: '#3B82F6', borderBottomRightRadius: 4 },
    theirBubble: { backgroundColor: '#F1F5F9', borderBottomLeftRadius: 4 },
    messageText: { fontSize: 16, lineHeight: 22 },
    myText: { color: '#FFFFFF' },
    theirText: { color: '#1E293B' },
    timestamp: { fontSize: 10, color: '#94A3B8', marginTop: 4, alignSelf: 'flex-end' },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        paddingBottom: Platform.OS === 'ios' ? 30 : 12,
        borderTopWidth: 1,
        borderTopColor: '#F1F5F9',
        backgroundColor: '#FFFFFF',
    },
    attachBtn: { padding: 8 },
    input: {
        flex: 1,
        backgroundColor: '#F8FAFC',
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingVertical: 8,
        marginHorizontal: 8,
        fontSize: 16,
        maxHeight: 100,
    },
    sendBtn: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#3B82F6',
        alignItems: 'center',
        justifyContent: 'center',
    },
});
