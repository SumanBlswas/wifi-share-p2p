import { useAuth } from '@/contexts/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { getUniqueId } from 'react-native-device-info';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import SmsRetriever from 'react-native-sms-retriever';

const { width } = Dimensions.get('window');

export default function OnboardingScreen() {
    const { login } = useAuth();
    const [phoneNumber, setPhoneNumber] = useState('');
    const [name, setName] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [step, setStep] = useState<1 | 2>(1);

    const requestGoogleHint = async () => {
        if (Platform.OS === 'android') {
            try {
                const phone = await SmsRetriever.requestPhoneNumber();
                if (phone) {
                    setPhoneNumber(phone);
                    setStep(2);
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                }
            } catch (error) {
                console.log('Phone hint failed', error);
                setStep(2);
            }
        } else {
            setStep(2);
        }
    };

    const handleConnect = async () => {
        if (!phoneNumber || phoneNumber.length < 5) return Alert.alert("Invalid Phone", "Please provide a valid number.");
        if (!name || name.length < 2) return Alert.alert("Invalid Name", "Please provide your name.");

        setIsLoading(true);
        try {
            const imei = await getUniqueId();
            const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${imei}-${phoneNumber}`);
            const nodeId = hash.substring(0, 10);
            await login(phoneNumber, nodeId, name);
        } catch (e) {
            Alert.alert("Error", "Could not create node identity.");
        }
        setIsLoading(false);
    };

    return (
        <View style={styles.container}>
            <SafeAreaView style={styles.safeArea}>
                <Animated.View entering={FadeInUp.duration(600)} style={styles.header}>
                    <View style={styles.logoContainer}>
                        <Ionicons name="infinite" size={56} color="#3B82F6" />
                    </View>
                    <Text style={styles.title}>Srot</Text>
                    <Text style={styles.subtitle}>Decentralized & Serverless</Text>
                </Animated.View>

                <Animated.View entering={FadeInDown.duration(800).delay(200)} style={styles.content}>
                    {step === 1 ? (
                        <View style={styles.card}>
                            <Text style={styles.cardTitle}>Identity setup</Text>
                            <Text style={styles.cardBody}>
                                Srot creates your unique mesh identity from your phone number and hardware.
                            </Text>
                            <TouchableOpacity
                                style={styles.primaryButton}
                                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); requestGoogleHint(); }}
                                disabled={isLoading}
                            >
                                {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Detect My Number</Text>}
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.secondaryButton} onPress={() => setStep(2)}>
                                <Text style={styles.secondaryText}>Manual setup</Text>
                            </TouchableOpacity>
                        </View>
                    ) : (
                        <View style={styles.card}>
                            <Text style={styles.label}>PHONE NUMBER</Text>
                            <TextInput
                                style={styles.input}
                                value={phoneNumber}
                                onChangeText={setPhoneNumber}
                                placeholder="+1 234 567 8900"
                                keyboardType="phone-pad"
                            />
                            <Text style={[styles.label, { marginTop: 20 }]}>DISPLAY NAME</Text>
                            <TextInput
                                style={styles.input}
                                value={name}
                                onChangeText={setName}
                                placeholder="Your Name"
                            />
                            <TouchableOpacity style={styles.primaryButton} onPress={handleConnect} disabled={isLoading}>
                                {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Enter Nexus</Text>}
                            </TouchableOpacity>
                        </View>
                    )}
                </Animated.View>
            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F8FAFC' },
    safeArea: { flex: 1 },
    header: { alignItems: 'center', marginTop: 100 },
    logoContainer: { width: 100, height: 100, borderRadius: 30, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
    title: { fontSize: 48, fontWeight: '900', color: '#1E293B', letterSpacing: 2 },
    subtitle: { fontSize: 16, color: '#94A3B8', marginTop: 8, textTransform: 'uppercase', letterSpacing: 1 },
    content: { flex: 1, paddingHorizontal: 32, justifyContent: 'center', paddingBottom: 100 },
    card: { backgroundColor: '#FFFFFF', borderRadius: 32, padding: 32, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 5 },
    cardTitle: { fontSize: 24, fontWeight: '800', color: '#1E293B', textAlign: 'center', marginBottom: 12 },
    cardBody: { fontSize: 16, color: '#64748B', textAlign: 'center', lineHeight: 24, marginBottom: 32 },
    label: { fontSize: 13, fontWeight: '700', color: '#94A3B8', marginBottom: 8, letterSpacing: 1 },
    input: { height: 60, backgroundColor: '#F1F5F9', borderRadius: 16, paddingHorizontal: 20, fontSize: 16, color: '#1E293B', marginBottom: 10 },
    primaryButton: { height: 60, backgroundColor: '#3B82F6', borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 24, shadowColor: '#3B82F6', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
    buttonText: { color: '#FFF', fontSize: 17, fontWeight: '700' },
    secondaryButton: { marginTop: 20, alignSelf: 'center' },
    secondaryText: { color: '#3B82F6', fontSize: 16, fontWeight: '600' }
});
