import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
    FlatList,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function ConversationsScreen() {
    const [search, setSearch] = useState('');

    const renderItem = ({ item }: { item: any }) => (
        <TouchableOpacity style={styles.card} activeOpacity={0.7}>
            <View style={styles.avatar}>
                <Ionicons name="chatbubble-ellipses" size={24} color="#3B82F6" />
            </View>
            <View style={styles.info}>
                <View style={styles.row}>
                    <Text style={styles.name}>{item.name}</Text>
                    <Text style={styles.time}>{item.time}</Text>
                </View>
                <Text style={styles.lastMsg} numberOfLines={1}>{item.lastMsg}</Text>
            </View>
        </TouchableOpacity>
    );

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>Messages</Text>
                <TouchableOpacity style={styles.newBtn}>
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
                data={[]} // Will be populated from SQLite database
                renderItem={renderItem}
                ListEmptyComponent={() => (
                    <View style={styles.empty}>
                        <Ionicons name="chatbubbles-outline" size={80} color="#E2E8F0" />
                        <Text style={styles.emptyText}>No conversations yet.</Text>
                        <Text style={styles.emptySub}>Start a P2P chat via the Nexus tab.</Text>
                    </View>
                )}
                contentContainerStyle={styles.listContent}
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
        fontWeight: '800',
        color: '#0F172A',
    },
    newBtn: {
        width: 44,
        height: 44,
        borderRadius: 22,
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
        height: 56,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        marginBottom: 20,
    },
    searchIcon: {
        marginRight: 12,
    },
    searchInput: {
        flex: 1,
        fontSize: 16,
        color: '#1E293B',
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
    info: {
        flex: 1,
    },
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 4,
    },
    name: {
        fontSize: 17,
        fontWeight: '700',
        color: '#1E293B',
    },
    time: {
        fontSize: 13,
        color: '#94A3B8',
    },
    lastMsg: {
        fontSize: 15,
        color: '#64748B',
    },
    empty: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 100,
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
    }
});
