import { useAuth } from '@/contexts/AuthContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import { useWebRTC } from '@/contexts/WebRTCContext';
import { GlobalSigClient } from '@/services/GlobalSigClient';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
    Dimensions,
    FlatList,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as Contacts from 'expo-contacts';

const { width } = Dimensions.get('window');

// Multi-language titles for "Srot" (Regional Indian Languages)
const TITLES = [
    'Srot',      // English phonetic
    'स्रोत',       // Hindi/Marathi
    'স্রোত',       // Bengali/Assamese
    'स्त्रोत',      // Alternative Hindi
    'સ્ત્રોત',    // Gujarati
    'ಸ್ರೋತ್',      // Kannada
    'സ്രോതസ്സ്',   // Malayalam
    'சிரோத்',      // Tamil
    'స్రోత్',       // Telugu
    'ᱥᱨᱚᱛ'        // Santali
];

const normalizePhone = (num: string) => {
    if (!num) return '';
    // If it looks like a hash or GUID (longer, has letters), leave it alone
    if (num.length > 15 || /[a-zA-Z]/.test(num)) return num;

    // Remove all non-numeric characters except +
    let cleaned = num.replace(/[^\d+]/g, '');
    // If it starts with 0 or has no +, assume local and remove leading 0
    if (cleaned.startsWith('0')) cleaned = cleaned.substring(1);
    // Remove +91 or 91 if it's there for matching
    if (cleaned.startsWith('91') && cleaned.length > 10) cleaned = cleaned.substring(2);
    else if (cleaned.startsWith('+91')) cleaned = cleaned.substring(3);

    return cleaned;
};

export default function NexusScreen() {
    const router = useRouter();
    const { db } = useDatabase();
    const { userId, name: userName, phoneNumber, profileImage } = useAuth();
    const { peers } = useWebRTC();
    const [search, setSearch] = useState('');
    const [titleIndex, setTitleIndex] = useState(0);
    const [contacts, setContacts] = useState<any[]>([]);
    const [onlinePeers, setOnlinePeers] = useState<any[]>([]);

    const fetchContacts = async () => {
        const { status } = await Contacts.requestPermissionsAsync();
        if (status === 'granted') {
            const { data } = await Contacts.getContactsAsync({
                fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails],
            });

            if (data.length > 0) {
                const mapped: any[] = [];
                data.forEach(c => {
                    if (c.phoneNumbers && c.phoneNumbers.length > 0) {
                        c.phoneNumbers.forEach((p, idx) => {
                            if (p.number) {
                                mapped.push({
                                    id: `${c.id}-${idx}`,
                                    name: c.name,
                                    phone: p.number,
                                    subPhone: p.number.replace(/\s/g, '').replace(/[-\(\)]/g, ''),
                                });
                            }
                        });
                    }
                });
                mapped.sort((a, b) => a.name.localeCompare(b.name));
                setContacts(mapped);
            }
        }
    };

    useEffect(() => {
        fetchContacts();
    }, [phoneNumber, userName]);

    useEffect(() => {
        const interval = setInterval(() => {
            setTitleIndex((prev) => (prev + 1) % TITLES.length);
        }, 3000);

        // Discovery Logic (Global Only)
        const handlePeerIdentified = (peer: any) => {
            if (userId && normalizePhone(peer.id) === normalizePhone(userId)) return; // Filter out self
            setOnlinePeers(prev => {
                const existingIdx = prev.findIndex(p => normalizePhone(p.id) === normalizePhone(peer.id));
                if (existingIdx !== -1) {
                    const updated = [...prev];
                    const existingPeer = updated[existingIdx];
                    updated[existingIdx] = {
                        ...existingPeer,
                        ...peer,
                        type: 'global'
                    };
                    return updated;
                }
                return [...prev, { ...peer, type: 'global' }];
            });
        };

        const handleGlobalOffline = (peerId: string) => {
            setOnlinePeers(prev => prev.filter(p => normalizePhone(p.id) !== normalizePhone(peerId)));
        };

        GlobalSigClient.on('peer_online', (id: string) => {
            if (id === userId) return;
        });
        GlobalSigClient.on('peer_identified', handlePeerIdentified);
        GlobalSigClient.on('peer_offline', handleGlobalOffline);

        // Periodically refresh global peers to stay synced
        const scanInterval = setInterval(() => GlobalSigClient.refreshPeers(), 30000);
        GlobalSigClient.refreshPeers();

        return () => {
            clearInterval(interval);
            clearInterval(scanInterval);
            GlobalSigClient.off('peer_identified', handlePeerIdentified);
            GlobalSigClient.off('peer_offline', handleGlobalOffline);
        };
    }, [userId]);

    const filteredContacts = contacts.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.phone.includes(search)
    );

    const renderItem = ({ item }: { item: any }) => (
        <TouchableOpacity
            style={[styles.card, item.type === 'local' || item.type === 'global' ? styles.peerCard : null]}
            onPress={async () => {
                if (item.type === 'local' || item.type === 'global') {
                    // Start call with peer ID
                    router.push({
                        pathname: '/conversation/[id]',
                        params: {
                            id: item.id,
                            name: item.name
                        }
                    });
                } else {
                    if (db) {
                        await db.runAsync(
                            'INSERT OR IGNORE INTO contacts (id, name, phone) VALUES (?, ?, ?)',
                            [item.id, item.name, item.phone]
                        );
                    }
                    router.push({ pathname: '/conversation/[id]', params: { id: item.id } });
                }
            }}
        >
            <View style={[styles.cardAvatar, item.type === 'local' ? styles.localAvatar : null]}>
                <Ionicons name={item.type === 'local' || item.type === 'global' ? "radio-outline" : "person-outline"} size={24} color={item.type ? "#3B82F6" : "#94A3B8"} />
            </View>
            <View style={styles.cardInfo}>
                <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.cardPhone}>{item.type ? (item.type === 'local' ? `Local Network (${item.ip})` : 'Cloud Peer') : item.phone}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                    style={[styles.inviteButton, styles.callButton, { paddingHorizontal: 10 }]}
                    onPress={() => {
                        if (item.type) {
                            router.push({
                                pathname: '/call',
                                params: { type: 'outgoing', peerId: item.id, peerName: item.name, callType: 'audio' }
                            });
                        } else {
                            Linking.openURL(`tel:${item.phone}`);
                        }
                    }}
                >
                    <Ionicons name="call" size={18} color="#FFFFFF" />
                </TouchableOpacity>
                {item.type && (
                    <TouchableOpacity
                        style={[styles.inviteButton, styles.callButton, { paddingHorizontal: 10 }]}
                        onPress={() => {
                            router.push({
                                pathname: '/call',
                                params: { type: 'outgoing', peerId: item.id, peerName: item.name, callType: 'video' }
                            });
                        }}
                    >
                        <Ionicons name="videocam" size={18} color="#FFFFFF" />
                    </TouchableOpacity>
                )}
            </View>
        </TouchableOpacity>
    );

    const combinedData = useMemo(() => {
        const list = [...onlinePeers];
        const onlineIds = new Set(onlinePeers.map(p => normalizePhone(p.id)));

        filteredContacts.forEach(contact => {
            const normalizedPhone = normalizePhone(contact.phone);
            if (!onlineIds.has(normalizedPhone)) {
                list.push(contact);
            } else {
                // If online, update the entry in list with contact name if we have it
                const idx = list.findIndex(p => normalizePhone(p.id) === normalizedPhone);
                if (idx !== -1 && list[idx].name.includes('Global') || list[idx].name.includes('Peer at')) {
                    list[idx] = { ...list[idx], name: contact.name };
                }
            }
        });
        return list;
    }, [onlinePeers, filteredContacts]);

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <View style={styles.titleContainer}>
                    <Animated.Text
                        key={TITLES[titleIndex]}
                        entering={FadeInDown.duration(600)}
                        exiting={FadeOutUp.duration(600)}
                        style={styles.logoTitle}
                    >
                        {TITLES[titleIndex]}
                    </Animated.Text>
                </View>
                <TouchableOpacity
                    style={styles.refreshButton}
                    onPress={() => {
                        fetchContacts();
                        setOnlinePeers([]);
                        GlobalSigClient.refreshPeers();
                    }}
                >
                    <Ionicons name="cloud-download-outline" size={22} color="#3B82F6" />
                </TouchableOpacity>
            </View>

            <View style={styles.searchContainer}>
                <Ionicons name="search-outline" size={20} color="#94A3B8" style={styles.searchIcon} />
                <TextInput
                    style={styles.searchInput}
                    placeholder="Search identity or phone..."
                    placeholderTextColor="#94A3B8"
                    value={search}
                    onChangeText={setSearch}
                />
            </View>

            <FlatList
                data={combinedData}
                keyExtractor={(item) => item.id}
                ListHeaderComponent={() => (
                    <View style={styles.sectionHeader}>
                        <Text style={styles.sectionTitleHeader}>MY IDENTITY</Text>
                        <TouchableOpacity
                            style={styles.identityCard}
                            onPress={() => router.push('/(tabs)/settings')}
                        >
                            <View style={styles.myAvatar}>
                                {profileImage ? (
                                    <Image source={{ uri: profileImage }} style={styles.headerProfileImage} />
                                ) : (
                                    <Text style={styles.myAvatarText}>{userName?.charAt(0) || 'S'}</Text>
                                )}
                            </View>
                            <View style={styles.cardInfo}>
                                <Text style={styles.identityName}>{userName || 'Suman Biswas'}</Text>
                                <Text style={styles.identityPhone}>{phoneNumber || '7908357708'}</Text>
                            </View>
                            <View style={styles.inlineBadge}>
                                <View style={styles.onlineDot} />
                                <Text style={styles.onlineText}>ONLINE</Text>
                            </View>
                        </TouchableOpacity>

                        <TouchableOpacity style={styles.createGroupBtn}>
                            <Ionicons name="people-outline" size={18} color="#3B82F6" style={{ marginRight: 8 }} />
                            <Text style={styles.createGroupText}>Create Group</Text>
                        </TouchableOpacity>

                        <Text style={[styles.sectionTitleHeader, { marginTop: 28 }]}>ONLINE PEERS & CONTACTS</Text>
                    </View>
                )}
                renderItem={renderItem}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={() => (
                    <View style={{ alignItems: 'center', marginTop: 40 }}>
                        <Text style={{ color: '#94A3B8' }}>{contacts.length > 0 ? "No results found." : "Loading contacts..."}</Text>
                    </View>
                )}
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
        paddingBottom: 15,
    },
    titleContainer: {
        height: 45,
        justifyContent: 'center',
        flex: 1,
        overflow: 'hidden',
    },
    logoTitle: {
        fontSize: 34,
        fontWeight: '900',
        color: '#0F172A',
        fontFamily: Platform.OS === 'ios' ? 'System' : 'serif',
        position: 'absolute',
    },
    refreshButton: {
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: '#EFF6FF',
        alignItems: 'center',
        justifyContent: 'center',
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        marginHorizontal: 24,
        paddingHorizontal: 16,
        height: 54,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: '#F1F5F9',
        marginBottom: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.03,
        shadowRadius: 5,
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
    sectionHeader: {
        marginBottom: 10,
    },
    sectionTitleHeader: {
        fontSize: 12,
        fontWeight: '700',
        color: '#94A3B8',
        letterSpacing: 1.2,
        marginBottom: 12,
        textTransform: 'uppercase',
    },
    identityCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#3B82F6',
        borderRadius: 24,
        padding: 16,
        marginBottom: 12,
        shadowColor: '#3B82F6',
        shadowOpacity: 0.3,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
    },
    myAvatar: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: 'rgba(255,255,255,0.25)',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 16,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.3)',
        overflow: 'hidden',
    },
    headerProfileImage: {
        width: '100%',
        height: '100%',
    },
    myAvatarText: {
        color: '#FFFFFF',
        fontSize: 24,
        fontWeight: '700',
    },
    cardInfo: {
        flex: 1,
    },
    identityName: {
        color: '#FFFFFF',
        fontSize: 20,
        fontWeight: '700',
    },
    identityPhone: {
        color: 'rgba(255,255,255,0.85)',
        fontSize: 14,
        marginTop: 2,
    },
    inlineBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.2)',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 10,
    },
    onlineDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: '#4ADE80',
        marginRight: 6,
    },
    onlineText: {
        color: '#FFFFFF',
        fontSize: 10,
        fontWeight: '800',
    },
    createGroupBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#EFF6FF',
        alignSelf: 'flex-start',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 14,
        marginTop: 8,
    },
    createGroupText: {
        color: '#3B82F6',
        fontSize: 13,
        fontWeight: '700',
    },
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        borderRadius: 24,
        padding: 14,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#F1F5F9',
    },
    cardAvatar: {
        width: 60,
        height: 60,
        borderRadius: 30,
        backgroundColor: '#F1F5F9',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 16,
    },
    cardName: {
        fontSize: 17,
        fontWeight: '700',
        color: '#0F172A',
    },
    cardPhone: {
        fontSize: 13,
        color: '#94A3B8',
        marginTop: 2,
    },
    inviteButton: {
        backgroundColor: '#EFF6FF',
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 12,
    },
    inviteText: {
        color: '#3B82F6',
        fontSize: 13,
        fontWeight: '700',
    },
    peerCard: {
        borderColor: '#3B82F6',
        backgroundColor: '#F0F7FF',
    },
    localAvatar: {
        backgroundColor: '#DBEAFE',
    },
    callButton: {
        backgroundColor: '#3B82F6',
    },
    callButtonText: {
        color: '#FFFFFF',
    }
});
