import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as DocumentPicker from 'expo-document-picker';
import { useState } from 'react';
import {
    Alert, FlatList, Platform, StyleSheet, Text,
    TouchableOpacity, View
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

type SharedFile = {
    id: string;
    name: string;
    size: number;
    mimeType: string;
    uri: string;
    sharedAt: string;
};

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getMimeIcon(type: string): string {
    if (type.startsWith('image/')) return 'image';
    if (type.startsWith('video/')) return 'film';
    if (type.startsWith('audio/')) return 'musical-notes';
    if (type.includes('pdf')) return 'document';
    if (type.includes('zip') || type.includes('rar')) return 'archive';
    return 'document-text';
}

export default function FilesScreen() {
    const [files, setFiles] = useState<SharedFile[]>([]);
    const [uploading, setUploading] = useState(false);

    const pickAndShare = async () => {
        try {
            setUploading(true);
            const result = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
            if (result.canceled || !result.assets?.[0]) return;

            const asset = result.assets[0];
            const newFile: SharedFile = {
                id: Date.now().toString(),
                name: asset.name,
                size: asset.size ?? 0,
                mimeType: asset.mimeType ?? 'application/octet-stream',
                uri: asset.uri,
                sharedAt: new Date().toLocaleTimeString(),
            };
            setFiles(prev => [newFile, ...prev]);
        } catch (e) {
            Alert.alert('Error', 'Could not pick file.');
        } finally {
            setUploading(false);
        }
    };

    const renderFile = ({ item, index }: { item: SharedFile, index: number }) => (
        <Animated.View entering={FadeInDown.delay(index * 50).springify()}>
            <TouchableOpacity style={styles.fileRow} activeOpacity={0.8}>
                <View style={styles.fileIcon}>
                    <Ionicons name={getMimeIcon(item.mimeType) as any} size={24} color="#60a5fa" />
                </View>
                <View style={styles.fileInfo}>
                    <Text style={styles.fileName} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.fileMeta}>{formatBytes(item.size)} · {item.sharedAt}</Text>
                </View>
                <TouchableOpacity style={styles.shareBtn}>
                    <Ionicons name="share-social" size={18} color="#3b82f6" />
                </TouchableOpacity>
            </TouchableOpacity>
        </Animated.View>
    );

    return (
        <View style={styles.container}>
            <SafeAreaView style={styles.safeArea}>
                <BlurView intensity={60} tint="dark" style={styles.header}>
                    <View>
                        <Text style={styles.headerSub}>Peer-to-Peer</Text>
                        <Text style={styles.headerTitle}>File Sharing</Text>
                    </View>
                    <TouchableOpacity style={styles.uploadBtn} onPress={pickAndShare} disabled={uploading}>
                        <Ionicons name={uploading ? "hourglass" : "add"} size={22} color="#3b82f6" />
                    </TouchableOpacity>
                </BlurView>

                {/* How it works banner */}
                <View style={styles.infoBanner}>
                    <Ionicons name="wifi" size={18} color="#22c55e" />
                    <Text style={styles.infoText}>
                        Files shared peer-to-peer via WebRTC DataChannels. No size limits.
                    </Text>
                </View>

                {files.length === 0 ? (
                    <View style={styles.emptyState}>
                        <Ionicons name="folder-open-outline" size={72} color="#1e293b" />
                        <Text style={styles.emptyTitle}>No files shared yet</Text>
                        <Text style={styles.emptySubtitle}>Tap the + button to pick and share a file with a peer.</Text>
                        <TouchableOpacity style={styles.emptyBtn} onPress={pickAndShare}>
                            <Ionicons name="cloud-upload" size={18} color="#fff" style={{ marginRight: 8 }} />
                            <Text style={styles.emptyBtnText}>Share a File</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <FlatList
                        data={files}
                        keyExtractor={f => f.id}
                        renderItem={renderFile}
                        contentContainerStyle={{ paddingTop: 8, paddingBottom: 120 }}
                    />
                )}
            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#020617' },
    safeArea: { flex: 1 },
    header: {
        paddingHorizontal: 24,
        paddingTop: Platform.OS === 'ios' ? 8 : 20,
        paddingBottom: 16,
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.06)',
    },
    headerSub: { fontSize: 12, color: '#64748b', fontWeight: '500', textTransform: 'uppercase', letterSpacing: 1 },
    headerTitle: { fontSize: 26, fontWeight: '800', color: '#f8fafc', marginTop: 2 },
    uploadBtn: {
        width: 44, height: 44, borderRadius: 22,
        backgroundColor: 'rgba(59,130,246,0.12)',
        alignItems: 'center', justifyContent: 'center',
    },
    infoBanner: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: 'rgba(34,197,94,0.08)',
        marginHorizontal: 20, marginTop: 14,
        borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
        borderWidth: 1, borderColor: 'rgba(34,197,94,0.15)',
    },
    infoText: { color: '#94a3b8', fontSize: 13, marginLeft: 10, flex: 1 },
    fileRow: {
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 20, paddingVertical: 14,
        borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)',
    },
    fileIcon: {
        width: 48, height: 48, borderRadius: 14,
        backgroundColor: 'rgba(59,130,246,0.12)',
        alignItems: 'center', justifyContent: 'center', marginRight: 14,
    },
    fileInfo: { flex: 1 },
    fileName: { color: '#f1f5f9', fontSize: 15, fontWeight: '600' },
    fileMeta: { color: '#64748b', fontSize: 12, marginTop: 3 },
    shareBtn: {
        width: 38, height: 38, borderRadius: 19,
        backgroundColor: 'rgba(59,130,246,0.1)',
        alignItems: 'center', justifyContent: 'center',
    },
    emptyState: {
        flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40,
    },
    emptyTitle: { color: '#334155', fontSize: 18, fontWeight: '700', marginTop: 20 },
    emptySubtitle: { color: '#1e293b', fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 },
    emptyBtn: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: '#2563eb',
        paddingHorizontal: 24, paddingVertical: 14,
        borderRadius: 14, marginTop: 28,
    },
    emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
