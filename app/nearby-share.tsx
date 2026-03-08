import { useAuth } from '@/contexts/AuthContext';
import { DiscoveryService } from '@/services/DiscoveryService';
import { fileServer } from '@/services/FileServer';
import { SigServer } from '@/services/SigServer';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ExpoFileSystem from 'expo-file-system';
import { useRouter } from 'expo-router';
import * as ExpoSharing from 'expo-sharing';
import React, { useEffect, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    Easing,
    FlatList,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import DeviceInfo from 'react-native-device-info';
import { SafeAreaView } from 'react-native-safe-area-context';

const { width } = Dimensions.get('window');

const RadarCircle = ({ delay = 0 }) => {
    const scale = useRef(new Animated.Value(0)).current;
    const opacity = useRef(new Animated.Value(0.6)).current;

    useEffect(() => {
        const animate = () => {
            scale.setValue(0);
            opacity.setValue(0.6);
            Animated.parallel([
                Animated.timing(scale, {
                    toValue: 4,
                    duration: 4000,
                    delay,
                    easing: Easing.out(Easing.quad),
                    useNativeDriver: true,
                }),
                Animated.timing(opacity, {
                    toValue: 0,
                    duration: 4000,
                    delay,
                    easing: Easing.out(Easing.quad),
                    useNativeDriver: true,
                }),
            ]).start(() => animate());
        };
        animate();
    }, []);

    return (
        <Animated.View
            style={[
                styles.radarCircle,
                {
                    transform: [{ scale }],
                    opacity,
                },
            ]}
        />
    );
};

export default function NearbyShareScreen() {
    const router = useRouter();
    const { userId, name: userName } = useAuth();
    const [peers, setPeers] = useState<any[]>([]);
    const [isScanning, setIsScanning] = useState(true);

    // File Sharing State
    const [fileTransfer, setFileTransfer] = useState<{
        status: 'idle' | 'offering' | 'receiving' | 'done',
        progress: number,
        name: string,
        size: number
    }>({ status: 'idle', progress: 0, name: '', size: 0 });

    useEffect(() => {
        // Start Local Services
        const setupServices = async () => {
            if (userName && userId) {
                SigServer.setIdentityGetter(() => ({
                    name: userName,
                    phone: userId
                }));
            }
            await SigServer.start();
            DiscoveryService.startDiscovery(true);
        };

        setupServices();

        const handlePeerDiscovered = (peer: any) => {
            if (peer.phone && peer.phone === userId) return; // Filter out self
            setPeers(prev => {
                const exists = prev.find(p => p.ip === peer.ip || (p.phone && p.phone === peer.phone));
                if (exists) return prev;
                return [...prev, { ...peer, type: 'local' }];
            });
        };

        DiscoveryService.on('peer_discovered', handlePeerDiscovered);

        const scanInterval = setInterval(() => {
            DiscoveryService.startDiscovery(false);
        }, 10000);

        const handleSignal = async (signal: any) => {
            if (signal.type === 'file-offer') {
                console.log(`[NearbyShare] 📁 Incoming file offer: ${signal.fileName}`);
                setFileTransfer({ status: 'receiving', progress: 0, name: signal.fileName || 'file', size: signal.fileSize || 0 });

                if (signal.fileUrl) {
                    const downloadResumable = ExpoFileSystem.createDownloadResumable(
                        signal.fileUrl,
                        // @ts-ignore
                        ExpoFileSystem.documentDirectory + (signal.fileName || 'download'),
                        {},
                        (downloadProgress: any) => {
                            const progress = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
                            setFileTransfer(prev => ({ ...prev, progress }));
                        }
                    );
                    try {
                        const dlResult = await downloadResumable.downloadAsync();
                        if (dlResult && dlResult.uri) {
                            setFileTransfer(prev => ({ ...prev, status: 'done', progress: 1 }));
                            SigServer.sendSignal(signal.fromId, { type: 'file-accept', fromId: userId!, from: userName! });

                            if (await ExpoSharing.isAvailableAsync()) {
                                await ExpoSharing.shareAsync(dlResult.uri);
                            }
                        }
                    } catch (e) {
                        console.error('[NearbyShare] ❌ Download error:', e);
                        setFileTransfer({ status: 'idle', progress: 0, name: '', size: 0 });
                    }
                }
            } else if (signal.type === 'file-accept') {
                console.log(`[NearbyShare] ✅ Remote peer finished downloading file`);
                setFileTransfer(prev => ({ ...prev, status: 'done', progress: 1 }));
                fileServer.stop();
            }
        };

        SigServer.on('signal', handleSignal);

        return () => {
            clearInterval(scanInterval);
            DiscoveryService.off('peer_discovered', handlePeerDiscovered);
            SigServer.off('signal', handleSignal);
            SigServer.stop();
            fileServer.stop();
        };
    }, [userName, userId]);

    const handleShareFile = async (peer: any) => {
        try {
            const result = await DocumentPicker.getDocumentAsync({
                copyToCacheDirectory: true,
            });

            if (result.canceled || !result.assets || result.assets.length === 0) return;

            const file = result.assets[0];
            setFileTransfer({ status: 'offering', progress: 0, name: file.name, size: file.size || 0 });

            // Start local HTTP server
            fileServer.setFile(file.uri, file.size || 0, file.name, file.mimeType || 'application/octet-stream');
            fileServer.start(8080);

            // Get local IP dynamically
            const ip = await DeviceInfo.getIpAddress();
            const fileUrl = `http://${ip}:8080/download`;

            // Use the TCP connection we already have for this peer via SigServer
            SigServer.sendSignal(peer.phone || peer.ip, {
                type: 'file-offer',
                from: userName!,
                fromId: userId!,
                fileUrl,
                fileName: file.name,
                fileSize: file.size || 0
            });
        } catch (e) {
            console.error('[NearbyShare] ❌ File Share Error:', e);
            setFileTransfer({ status: 'idle', progress: 0, name: '', size: 0 });
        }
    };

    const renderItem = ({ item }: { item: any }) => (
        <TouchableOpacity
            style={styles.peerCard}
            onPress={() => handleShareFile(item)}
        >
            <View style={styles.peerAvatar}>
                <Ionicons name="phone-portrait-outline" size={24} color="#3B82F6" />
                <View style={styles.onlineBadge} />
            </View>
            <View style={styles.peerInfo}>
                <Text style={styles.peerName}>{item.name}</Text>
                <Text style={styles.peerIp}>{item.ip}</Text>
            </View>
            <TouchableOpacity style={styles.shareButton} onPress={() => handleShareFile(item)}>
                <Text style={styles.shareText}>SHARE</Text>
            </TouchableOpacity>
        </TouchableOpacity>
    );

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <Ionicons name="chevron-back" size={28} color="#0F172A" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Nearby Share</Text>
                <View style={{ width: 40 }} />
            </View>

            <View style={styles.radarContainer}>
                <RadarCircle delay={0} />
                <RadarCircle delay={1000} />
                <RadarCircle delay={2000} />

                <View style={styles.centerNode}>
                    <Ionicons name="wifi" size={32} color="#fff" />
                </View>

                <Text style={styles.scanningText}>Searching for nearby devices...</Text>
            </View>

            <View style={styles.peersListContainer}>
                <View style={styles.listHeader}>
                    <Text style={styles.listTitle}>AVAILABLE DEVICES</Text>
                    {isScanning && <Text style={styles.discoveryStatus}>Scanning...</Text>}
                </View>

                <FlatList
                    data={peers}
                    renderItem={renderItem}
                    keyExtractor={(item) => item.ip}
                    contentContainerStyle={styles.listContent}
                    ListEmptyComponent={() => (
                        <View style={styles.emptyContainer}>
                            <Text style={styles.emptyText}>No devices found yet.</Text>
                            <Text style={styles.emptySub}>Make sure other devices are also in the Nearby Share screen.</Text>
                        </View>
                    )}
                />

                {fileTransfer.status !== 'idle' && (
                    <View style={styles.fileTransferBadge}>
                        <Ionicons name={fileTransfer.status === 'receiving' ? "download" : "cloud-upload"} size={24} color="#fff" />
                        <View style={{ flex: 1 }}>
                            <Text style={styles.fileTransferText}>
                                {fileTransfer.status === 'receiving' ? "Receiving" : fileTransfer.status === 'offering' ? "Sending" : "Completed"}: {fileTransfer.name}
                            </Text>
                            <View style={styles.progressBarBg}>
                                <View style={[styles.progressBarFill, { width: `${fileTransfer.progress * 100}%` }]} />
                            </View>
                        </View>
                        <Text style={styles.progressText}>{Math.round(fileTransfer.progress * 100)}%</Text>
                    </View>
                )}
            </View>
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
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingVertical: 15,
        backgroundColor: '#fff',
    },
    backButton: {
        padding: 5,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: '800',
        color: '#0F172A',
    },
    radarContainer: {
        height: 300,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    radarCircle: {
        position: 'absolute',
        width: 100,
        height: 100,
        borderRadius: 50,
        borderWidth: 1,
        borderColor: '#3B82F6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
    },
    centerNode: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: '#3B82F6',
        alignItems: 'center',
        justifyContent: 'center',
        elevation: 10,
        shadowColor: '#3B82F6',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.3,
        shadowRadius: 10,
        zIndex: 10,
    },
    scanningText: {
        marginTop: 40,
        fontSize: 14,
        color: '#64748B',
        fontWeight: '600',
    },
    peersListContainer: {
        flex: 1,
        backgroundColor: '#fff',
        borderTopLeftRadius: 32,
        borderTopRightRadius: 32,
        paddingHorizontal: 24,
        paddingTop: 30,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -10 },
        shadowOpacity: 0.05,
        shadowRadius: 20,
        elevation: 5,
    },
    listHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
    },
    listTitle: {
        fontSize: 12,
        fontWeight: '800',
        color: '#94A3B8',
        letterSpacing: 1.2,
    },
    discoveryStatus: {
        fontSize: 11,
        color: '#3B82F6',
        fontWeight: '700',
    },
    listContent: {
        paddingBottom: 40,
    },
    peerCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F8FAFC',
        borderRadius: 20,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#F1F5F9',
    },
    peerAvatar: {
        width: 50,
        height: 50,
        borderRadius: 25,
        backgroundColor: '#DBEAFE',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 16,
    },
    onlineBadge: {
        position: 'absolute',
        bottom: 2,
        right: 2,
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: '#4ADE80',
        borderWidth: 2,
        borderColor: '#F8FAFC',
    },
    peerInfo: {
        flex: 1,
    },
    peerName: {
        fontSize: 16,
        fontWeight: '700',
        color: '#0F172A',
    },
    peerIp: {
        fontSize: 13,
        color: '#64748B',
        marginTop: 2,
    },
    shareButton: {
        backgroundColor: '#3B82F6',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 12,
    },
    shareText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '800',
    },
    emptyContainer: {
        alignItems: 'center',
        marginTop: 40,
        paddingHorizontal: 20,
    },
    emptyText: {
        fontSize: 16,
        fontWeight: '700',
        color: '#475569',
        marginBottom: 8,
    },
    emptySub: {
        fontSize: 13,
        color: '#94A3B8',
        textAlign: 'center',
        lineHeight: 20,
    },
    fileTransferBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(59, 130, 246, 0.9)',
        padding: 16,
        borderRadius: 20,
        marginTop: 20,
        shadowColor: '#3B82F6',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 10,
        elevation: 5,
        gap: 16,
    },
    fileTransferText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '700',
        marginBottom: 8,
    },
    progressBarBg: {
        height: 6,
        backgroundColor: 'rgba(255, 255, 255, 0.3)',
        borderRadius: 3,
        overflow: 'hidden',
    },
    progressBarFill: {
        height: 6,
        backgroundColor: '#fff',
        borderRadius: 3,
    },
    progressText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '800',
    }
});
