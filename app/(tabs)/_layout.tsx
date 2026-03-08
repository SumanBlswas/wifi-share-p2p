import { Feather, Ionicons, MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAudioPlayer } from 'expo-audio';
import { BlurView } from 'expo-blur';
import { Tabs } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
    Alert,
    Dimensions,
    Linking,
    Modal,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View
} from 'react-native';
import DeviceInfo from 'react-native-device-info';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import PagerView from 'react-native-pager-view';
import Animated, {
    Easing,
    Extrapolate,
    FadeInDown,
    interpolate,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withSpring,
    withTiming
} from 'react-native-reanimated';

const SCREEN_WIDTH = Dimensions.get('window').width;

// DTMF standard keypad frequencies
const DTMF_FREQS: Record<string, [number, number]> = {
    '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
    '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
    '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
    '*': [941, 1209], '0': [941, 1336], '#': [941, 1477],
};

// Generates a proper mathematical .wav sound byte array for DTMF frequencies directly in code
function generateDTMFBase64(key: string): string {
    const [f1, f2] = DTMF_FREQS[key] || [0, 0];
    const sampleRate = 8000;
    const duration = 0.12; // 120ms beep
    const numSamples = Math.floor(sampleRate * duration);
    const buffer = new Uint8Array(44 + numSamples);
    const view = new DataView(buffer.buffer);

    // Write WAV Header
    const writeString = (offset: number, str: string) => {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + numSamples, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate, true);
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true); // 8-bit
    writeString(36, 'data');
    view.setUint32(40, numSamples, true);

    // Write Sine Waves Payload with an Amplitude Envelope to stop popping/clicking
    for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        const sample = 0.5 * (Math.sin(2 * Math.PI * f1 * t) + Math.sin(2 * Math.PI * f2 * t));

        // Apply envelope: quick fade out in the last 15% of the sound to stop audio clipping/popping
        let envelope = 1.0;
        const fadeOutStart = numSamples * 0.85;
        if (i > fadeOutStart) {
            envelope = 1.0 - ((i - fadeOutStart) / (numSamples - fadeOutStart));
        }

        buffer[44 + i] = Math.floor(((sample * envelope) + 1) * 127.5);
    }

    // Extremely fast pure JS Base64 encode
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let base64 = '';
    const len = buffer.length;
    for (let i = 0; i < len; i += 3) {
        base64 += chars[buffer[i] >> 2];
        base64 += chars[((buffer[i] & 3) << 4) | (buffer[i + 1] >> 4)];
        base64 += chars[((buffer[i + 1] & 15) << 2) | (buffer[i + 2] >> 6)];
        base64 += chars[buffer[i + 2] & 63];
    }
    if ((len % 3) === 2) base64 = base64.substring(0, base64.length - 1) + '=';
    else if (len % 3 === 1) base64 = base64.substring(0, base64.length - 2) + '==';
    return 'data:audio/wav;base64,' + base64;
}

import { useDatabase } from '@/contexts/DatabaseContext';
import { UIEvents, UI_EVENT_TYPES } from '@/utils/UIEvents';
import { useRouter } from 'expo-router';

function CustomTabBar({ state, descriptors, navigation }: any) {
    const router = useRouter();
    const { db } = useDatabase();

    useEffect(() => {
        const handleOpenDialer = (number?: string) => {
            setIsDialerVisible(true);
            if (number) setDialerNumber(number);
        };
        UIEvents.on(UI_EVENT_TYPES.OPEN_DIALER, handleOpenDialer);
        return () => {
            UIEvents.off(UI_EVENT_TYPES.OPEN_DIALER, handleOpenDialer);
        };
    }, []);

    const translateX = useSharedValue(0);
    const pulseValue = useSharedValue(0);
    const visibleRoutes = state.routes.filter((r: any) => !['conversations', 'files'].includes(r.name));

    // Exact sizing approximations from screenshot proportions
    const TAB_CONTAINER_WIDTH = 250;
    const TAB_ITEM_WIDTH = TAB_CONTAINER_WIDTH / visibleRoutes.length;
    const PILL_WIDTH = 68; // Width of the active blue magnifier
    const PILL_HEIGHT = 52; // Height of active indicator inside the 64px bar

    const [isDialerVisible, setIsDialerVisible] = useState(false);
    const [dialerNumber, setDialerNumber] = useState('');
    const [showDefaultPrompt, setShowDefaultPrompt] = useState(false);
    const [isXiaomi, setIsXiaomi] = useState(false);

    useEffect(() => {
        const checkBrand = async () => {
            const brand = (await DeviceInfo.getBrand()).toLowerCase();
            setIsXiaomi(brand === 'xiaomi' || brand === 'poco' || brand === 'redmi');
        };
        checkBrand();
    }, []);

    // Request to be default dialer when opened (DISABLED FOR NOW)
    useEffect(() => {
        /*
        if (isDialerVisible) {
            const checkDefault = async () => {
                const hasPrompted = await AsyncStorage.getItem('@has_prompted_default_dialer');
                if (!hasPrompted && Platform.OS === 'android') {
                    // Small delay to let dialer open first
                    setTimeout(() => setShowDefaultPrompt(true), 600);
                }
            };
            checkDefault();
        }
        */
    }, [isDialerVisible]);

    // Continuous pulse effect for the dialer
    useEffect(() => {
        pulseValue.value = withRepeat(
            withTiming(1, { duration: 2500 }),
            -1,
            false // Do not reverse, create an endless outward ripple
        );
    }, []);

    useEffect(() => {
        const activeIndex = visibleRoutes.findIndex((r: any) => r.name === state.routes[state.index].name);
        if (activeIndex !== -1) {
            // Calculate center of the active tab to position the pill correctly
            const targetX = (activeIndex * TAB_ITEM_WIDTH) + (TAB_ITEM_WIDTH / 2) - (PILL_WIDTH / 2);
            translateX.value = withSpring(targetX, {
                damping: 20,
                stiffness: 150,
            });
        }
    }, [state.index, visibleRoutes, TAB_ITEM_WIDTH]);

    const handleCall = async () => {
        if (!dialerNumber || dialerNumber.length < 3) return;

        setIsDialerVisible(false);
        const targetNumber = dialerNumber;
        setDialerNumber('');

        try {
            // Check if contact exists in our Mesh database
            if (db) {
                const results = await db.getAllAsync('SELECT id, name FROM contacts WHERE phone = ? OR phone LIKE ?', [targetNumber, `%${targetNumber}`]);

                if (results.length > 0) {
                    const contact = results[0] as { id: string, name: string };
                    console.log(`[Dialer] Found Mesh contact: ${contact.name} (${contact.id})`);

                    // Route to Internal Calling
                    router.push({
                        pathname: '/call',
                        params: {
                            peerId: contact.id,
                            peerName: contact.name,
                            type: 'outgoing'
                        }
                    });
                    return;
                }
            }

            // Fallback: Use SIM Card / Native Dialer
            console.log(`[Dialer] No Mesh contact for ${targetNumber}, falling back to SIM`);
            const url = `tel:${targetNumber}`;
            const supported = await Linking.canOpenURL(url);
            if (supported) {
                await Linking.openURL(url);
            } else {
                Alert.alert("Error", "Native dialer not available");
            }
        } catch (error) {
            console.error("[Dialer] Call failed:", error);
        }
    };

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: translateX.value }],
    }));

    const pulseAnimatedStyle = useAnimatedStyle(() => {
        let op = 0;
        // Fade in incredibly fast right at the start so we only see it when escaping the circle
        if (pulseValue.value < 0.1) {
            op = (pulseValue.value / 0.1) * 0.7;
        } else {
            // Then slowly fade all the way out as it travels outward to 100%
            op = 0.7 * (1 - (pulseValue.value - 0.1) / 0.9);
        }

        return {
            transform: [{ scale: 1 + pulseValue.value * 1.0 }], // Expand outwards significantly
            opacity: op,
        };
    });

    return (
        <View style={styles.navContainer}>
            {/* Main Pill Bar with tricky Blur Effect */}
            <View style={styles.tabContainerShadow}>
                <View style={styles.tabContainer}>
                    <BlurView intensity={80} tint="light" style={StyleSheet.absoluteFill}>
                        <View style={styles.blurOverlay} />
                    </BlurView>

                    {/* The Sliding Blue Magnifier Indicator */}
                    <Animated.View style={[styles.magnifier, { width: PILL_WIDTH }, animatedStyle]} />

                    {visibleRoutes.map((route: any, index: number) => {
                        const isFocused = state.routes[state.index].name === route.name;

                        const onPress = () => {
                            const event = navigation.emit({
                                type: 'tabPress',
                                target: route.key,
                                canPreventDefault: true,
                            });
                            if (!isFocused && !event.defaultPrevented) {
                                navigation.navigate(route.name);
                            }
                        };

                        // Exact icons from the screenshot
                        let iconName: any = 'command';
                        if (route.name === 'nexus') iconName = 'users';
                        if (route.name === 'chat') iconName = 'message-square';

                        return (
                            <TouchableOpacity
                                key={route.key}
                                onPress={onPress}
                                style={[styles.tabItem, { width: TAB_ITEM_WIDTH }]}
                                activeOpacity={0.8}
                            >
                                <Feather
                                    name={iconName}
                                    size={26}
                                    color={isFocused ? '#334155' : '#94A3B8'} // Dark Slate active, Medium Gray inactive
                                />
                            </TouchableOpacity>
                        );
                    })}
                </View>
            </View>

            {/* Premium layered glowing Dialer floating visually higher */}
            <View style={styles.dialerWrapper}>
                {/* The "pulse" ring behind the FAB */}
                <Animated.View style={[styles.pulseRing, pulseAnimatedStyle]} />

                <View style={styles.dialerFabShadow}>
                    <BlurView intensity={30} tint="light" style={styles.dialerFab}>
                        {/* The shiny glare element giving the 3D bubble effect */}
                        <View style={styles.fabGlare} />

                        <TouchableOpacity
                            style={styles.dialerButtonInner}
                            activeOpacity={0.8}
                            onPress={() => setIsDialerVisible(true)}
                        >
                            <MaterialIcons name="dialpad" size={32} color="#0F172A" />
                        </TouchableOpacity>
                    </BlurView>
                </View>
            </View>

            {/* Premium Dialer Modal */}
            <Modal
                visible={isDialerVisible}
                animationType="slide"
                transparent
                onRequestClose={() => setIsDialerVisible(false)}
            >
                <View style={styles.modalOverlay}>
                    <Pressable style={styles.modalDismiss} onPress={() => setIsDialerVisible(false)} />
                    <Animated.View style={styles.dialerSheet}>
                        <View style={styles.dialerHeader}>
                            <View style={styles.notch} />
                            <TextInput
                                style={styles.dialerDisplay}
                                value={dialerNumber}
                                placeholder="Enter number..."
                                placeholderTextColor="#94A3B8"
                                editable={false}
                            />
                        </View>

                        <View style={styles.keypad}>
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, '*', 0, '#'].map((key) => {
                                const keyStr = key.toString();
                                return (
                                    <TouchableOpacity
                                        key={keyStr}
                                        style={styles.key}
                                        onPress={() => {
                                            setDialerNumber(prev => prev + keyStr);
                                            // Play native mathematical sound instantly
                                            try {
                                                const uri = generateDTMFBase64(keyStr);
                                                const player = createAudioPlayer(uri);
                                                player.play();
                                            } catch (e) {
                                                console.log("Audio play fail", e);
                                            }
                                        }}
                                    >
                                        <Text style={styles.keyText}>{keyStr}</Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>

                        <View style={styles.dialerFooter}>
                            <TouchableOpacity
                                style={styles.backspace}
                                onPress={() => setDialerNumber(prev => prev.slice(0, -1))}
                            >
                                <Ionicons name="backspace-outline" size={28} color="#94A3B8" />
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={styles.callButton}
                                onPress={handleCall}
                            >
                                <Ionicons name="call" size={32} color="#FFFFFF" />
                            </TouchableOpacity>

                            <TouchableOpacity style={styles.closeDialer} onPress={() => setIsDialerVisible(false)}>
                                <Ionicons name="close" size={28} color="#94A3B8" />
                            </TouchableOpacity>
                        </View>
                    </Animated.View>
                </View>
            </Modal>

            {/* Premium Default Dialer Prompt Modal */}
            <Modal
                visible={showDefaultPrompt}
                transparent
                animationType="fade"
                onRequestClose={() => setShowDefaultPrompt(false)}
            >
                <View style={styles.promptOverlay}>
                    <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFill} />
                    <Animated.View
                        entering={FadeInDown.duration(500).springify()}
                        style={styles.promptCard}
                    >
                        <View style={styles.promptIconBg}>
                            <Ionicons name="call" size={32} color="#3B82F6" />
                            <View style={styles.promptBadge}>
                                <Ionicons name="checkmark-circle" size={16} color="#22C55E" />
                            </View>
                        </View>

                        <Text style={styles.promptTitle}>Default Dialer</Text>
                        <Text style={styles.promptSubtitle}>
                            {isXiaomi
                                ? "On Xiaomi App Info:\n1. Tap 'Other Permissions' -> Enable 'Display pop-up windows'.\n2. Go back -> 3 dots -> 'Default apps' -> 'Dial' -> Select Srot."
                                : "Set Srot as your primary phone app to handle all calls and enjoy a seamless P2P experience."
                            }
                        </Text>

                        <TouchableOpacity
                            style={styles.promptPrimaryBtn}
                            onPress={() => {
                                if (isXiaomi) {
                                    // Try to open Manage Apps or just App Info
                                    Linking.openSettings();
                                } else {
                                    Linking.openSettings();
                                }
                                AsyncStorage.setItem('@has_prompted_default_dialer', 'true');
                                setShowDefaultPrompt(false);
                            }}
                        >
                            <Text style={styles.promptPrimaryText}>
                                {isXiaomi ? "Open App Info" : "Set as Default"}
                            </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.promptSecondaryBtn}
                            onPress={() => setShowDefaultPrompt(false)}
                        >
                            <Text style={styles.promptSecondaryText}>Maybe Later</Text>
                        </TouchableOpacity>
                    </Animated.View>
                </View>
            </Modal>
        </View>
    );
}

const TouchableOpacity = (props: any) => (
    <Pressable
        {...props}
        style={({ pressed }) => [
            props.style,
            { opacity: pressed ? 0.6 : 1, transform: [{ scale: pressed ? 0.96 : 1 }] }
        ]}
    />
);

import { useUI } from "@/contexts/UIContext";

function StackSwitcher({ state, descriptors, navigation, visibleRoutes, activeIndex }: any) {
    // Current translation of the stack
    const translateX = useSharedValue(-activeIndex * SCREEN_WIDTH);
    const contextX = useSharedValue(0);

    // Sync when navigation happens via bottom bar icons
    useEffect(() => {
        translateX.value = withTiming(-activeIndex * SCREEN_WIDTH, {
            duration: 350,
            easing: Easing.bezier(0.25, 0.1, 0.25, 1) // Smooth standard Ease
        });
    }, [activeIndex]);

    const panGesture = Gesture.Pan()
        .activeOffsetX([-10, 10]) // Don't trigger on tiny movements (prevents accidental taps)
        .failOffsetY([-15, 15])   // If user is scrolling up/down significantly, fail this gesture
        .onStart(() => {
            contextX.value = translateX.value;
        })
        .onUpdate((event) => {
            const newX = contextX.value + event.translationX;
            // Only allow swiping within the total width of pages - NO BOUNCING
            const minX = -(visibleRoutes.length - 1) * SCREEN_WIDTH;
            const maxX = 0;
            translateX.value = Math.max(minX, Math.min(maxX, newX));
        })
        .onEnd((event) => {
            const velocity = event.velocityX;
            const currentX = translateX.value;
            let targetIndex = Math.round(-currentX / SCREEN_WIDTH);

            // Allow flicking to next/prev
            if (Math.abs(velocity) > 500) {
                targetIndex = velocity > 0 ? activeIndex - 1 : activeIndex + 1;
            }
            targetIndex = Math.max(0, Math.min(visibleRoutes.length - 1, targetIndex));

            translateX.value = withTiming(-targetIndex * SCREEN_WIDTH, {
                duration: 300,
                easing: Easing.out(Easing.quad)
            }, (finished) => {
                if (finished && targetIndex !== activeIndex) {
                    runOnJS(navigation.navigate)(visibleRoutes[targetIndex].name);
                }
            });
        });

    return (
        <GestureDetector gesture={panGesture}>
            <View style={{ flex: 1, backgroundColor: '#020617' }}>
                {visibleRoutes.map((route: any, index: number) => {
                    const animatedStyle = useAnimatedStyle(() => {
                        const pageOffset = index * SCREEN_WIDTH;
                        const progress = (translateX.value + pageOffset) / SCREEN_WIDTH;

                        // 1st is on top (Index 0), 2nd beneath (Index 1), etc.
                        const zIndex = 10 - index;

                        if (progress <= 0) {
                            // Current page or page being swiped AWAY to the left (Top Layer)
                            // User: "1st one stays on top until it goes outside window"
                            return {
                                transform: [{ translateX: translateX.value + pageOffset }],
                                zIndex,
                                borderRadius: 0,
                                opacity: 1,
                            };
                        } else {
                            // Any page that is BENEATH the current one (Underneath Layer)
                            // User: "2nd one behind... expands to fill screen with rounded border coming to square"
                            const scale = interpolate(progress, [0, 1], [1, 0.90], Extrapolate.CLAMP);
                            const borderRadius = interpolate(progress, [0, 1], [0, 48], Extrapolate.CLAMP);
                            const opacity = interpolate(progress, [0, 0.8], [1, 0.7], Extrapolate.CLAMP);

                            return {
                                transform: [{ scale }],
                                borderRadius,
                                opacity,
                                zIndex,
                                left: 0,
                                top: 0,
                                position: 'absolute',
                                width: SCREEN_WIDTH,
                                height: '100%',
                            };
                        }
                    });

                    return (
                        <Animated.View
                            key={route.key}
                            style={[
                                StyleSheet.absoluteFill,
                                animatedStyle,
                                { backgroundColor: '#F8FAFC', overflow: 'hidden' }
                            ]}
                        >
                            {descriptors[route.key].render()}
                        </Animated.View>
                    );
                })}
            </View>
        </GestureDetector>
    );
}

function TabContent({ state, descriptors, navigation, pageAnimation }: any) {
    const pagerRef = useRef<PagerView>(null);
    const visibleRoutes = state.routes.filter((r: any) => !['conversations', 'files'].includes(r.name));
    const activeIndex = visibleRoutes.findIndex((r: any) => r.name === state.routes[state.index].name);

    // Slide implementation - Using PagerView as requested ("keep the slide one as it is")
    useEffect(() => {
        if (pageAnimation === 'Slide' && activeIndex !== -1) {
            pagerRef.current?.setPage(activeIndex);
        }
    }, [state.index, visibleRoutes, pageAnimation, activeIndex]);

    if (pageAnimation === 'Stack') {
        return (
            <StackSwitcher
                state={state}
                descriptors={descriptors}
                navigation={navigation}
                visibleRoutes={visibleRoutes}
                activeIndex={activeIndex}
            />
        );
    }

    // Default Slide behavior using PagerView
    return (
        <View style={{ flex: 1 }}>
            <PagerView
                ref={pagerRef}
                style={{ flex: 1 }}
                initialPage={0}
                scrollEnabled={true}
                onPageSelected={(e) => {
                    const route = visibleRoutes[e.nativeEvent.position];
                    if (route && route.name !== state.routes[state.index].name) {
                        navigation.navigate(route.name);
                    }
                }}
            >
                {visibleRoutes.map((route: any) => (
                    <View key={route.key} style={{ flex: 1 }}>
                        {descriptors[route.key].render()}
                    </View>
                ))}
            </PagerView>
        </View>
    );
}

export default function TabsLayout() {
    const { pageAnimation } = useUI();

    return (
        <Tabs
            tabBar={(props) => (
                <View style={[StyleSheet.absoluteFill, { backgroundColor: '#F8FAFC' }]}>
                    <TabContent {...props} pageAnimation={pageAnimation} />
                    <CustomTabBar {...props} />
                </View>
            )}
            screenOptions={{
                headerShown: false,
                // Using 'fade' to stop the property crash, Pager handles the actual sliding
                animation: 'fade',
            }}
        >
            <Tabs.Screen name="nexus" options={{ title: 'Nexus' }} />
            <Tabs.Screen name="chat" options={{ title: 'Chat' }} />
            <Tabs.Screen name="settings" options={{ title: '', tabBarLabel: () => null }} />
            <Tabs.Screen name="files" options={{ href: null }} />
        </Tabs>
    );
}

const styles = StyleSheet.create({
    navContainer: {
        position: 'absolute',
        bottom: 24, // Fixed distance from bottom
        left: 0,
        right: 0,
        alignItems: 'center',
        justifyContent: 'center',
    },
    // The trick to separate shadows from overflow: hidden on Android/iOS
    tabContainerShadow: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 10,
        elevation: 6,
        borderRadius: 32,
    },
    tabContainer: {
        width: 250,
        height: 64,
        borderRadius: 32,
        flexDirection: 'row',
        alignItems: 'center',
        overflow: 'hidden', // CRITICAL for BlurView rounding
    },
    blurOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(255, 255, 255, 0.6)', // Adds the exact frosted whitish tint over the blur
    },
    magnifier: {
        position: 'absolute',
        height: 52, // Soft padding inside the 64px bar
        borderRadius: 26,
        backgroundColor: '#CFE0FE', // Exact soft blue from screenshot
        top: 6, // Centered inside 64px container (64 - 52) / 2
    },
    tabItem: {
        height: 64,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1,
    },
    dialerWrapper: {
        position: 'absolute',
        right: 25,
        bottom: 110, // Moved significantly MORE UP above everything
        alignItems: 'center',
        justifyContent: 'center',
        width: 80,
        height: 80,
        zIndex: 10,
    },
    pulseRing: {
        position: 'absolute',
        width: 76,
        height: 76,
        borderRadius: 38,
        backgroundColor: '#CFE0FE', // Soft matching blue
    },
    dialerFabShadow: {
        shadowColor: '#3B82F6',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.25,
        shadowRadius: 15,
        elevation: 12,
        borderRadius: 38,
    },
    dialerFab: {
        width: 76,
        height: 76,
        borderRadius: 38,
        overflow: 'hidden', // Forces BlurView into a circle
        backgroundColor: 'rgba(215, 230, 255, 0.6)', // Slightly more transparent so the border pops
        borderWidth: 1.5,
        borderColor: 'rgba(255, 255, 255, 0.85)', // The crisp frosted rim for the "true glass" effect
    },
    fabGlare: {
        position: 'absolute',
        top: 8,
        left: 14,
        width: 28,
        height: 14,
        borderRadius: 7,
        backgroundColor: 'rgba(255, 255, 255, 0.9)', // Shiny white "bubble" highlight
        transform: [{ rotate: '-20deg' }],
    },
    dialerButtonInner: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },


    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(2, 6, 23, 0.4)',
        justifyContent: 'flex-end',
    },
    modalDismiss: {
        ...StyleSheet.absoluteFillObject,
    },
    dialerSheet: {
        backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 32,
        borderTopRightRadius: 32,
        paddingBottom: 40,
        paddingHorizontal: 24,
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 20,
        elevation: 15,
    },
    dialerHeader: {
        alignItems: 'center',
        paddingVertical: 15,
    },
    notch: {
        width: 40,
        height: 5,
        borderRadius: 3,
        backgroundColor: '#F1F5F9',
        marginBottom: 20,
    },
    dialerDisplay: {
        fontSize: 36,
        fontWeight: '700',
        color: '#0F172A',
        textAlign: 'center',
        height: 60,
        width: '100%',
        includeFontPadding: false,
        lineHeight: 45, // Gives enough vertical clearance to prevent cropping
    },
    keypad: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: 20,
        paddingVertical: 10,
    },
    key: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: '#F8FAFC',
        alignItems: 'center',
        justifyContent: 'center',
    },
    keyText: {
        fontSize: 32,
        fontWeight: '600',
        color: '#1E293B',
        includeFontPadding: false,
        lineHeight: 36, // Fixes Android text cropping
    },
    dialerFooter: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-around',
        marginTop: 30,
    },
    callButton: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: '#22C55E', // Green
        alignItems: 'center',
        justifyContent: 'center',
        elevation: 8,
    },
    backspace: {
        padding: 10,
    },
    closeDialer: {
        padding: 10,
    },
    // Prompt Styles
    promptOverlay: {
        flex: 1,
        backgroundColor: 'rgba(2, 6, 23, 0.6)',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
    },
    promptCard: {
        width: '100%',
        backgroundColor: '#FFFFFF',
        borderRadius: 32,
        padding: 32,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOpacity: 0.15,
        shadowRadius: 30,
        elevation: 10,
    },
    promptIconBg: {
        width: 80,
        height: 80,
        borderRadius: 24,
        backgroundColor: '#EFF6FF',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 24,
    },
    promptBadge: {
        position: 'absolute',
        bottom: -4,
        right: -4,
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        padding: 2,
    },
    promptTitle: {
        fontSize: 24,
        fontWeight: '800',
        color: '#1E293B',
        marginBottom: 12,
    },
    promptSubtitle: {
        fontSize: 15,
        color: '#64748B',
        textAlign: 'center',
        lineHeight: 22,
        marginBottom: 32,
        paddingHorizontal: 12,
    },
    promptPrimaryBtn: {
        width: '100%',
        height: 56,
        backgroundColor: '#3B82F6',
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 12,
        shadowColor: '#3B82F6',
        shadowOpacity: 0.2,
        shadowRadius: 10,
        elevation: 4,
    },
    promptPrimaryText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '700',
    },
    promptSecondaryBtn: {
        width: '100%',
        height: 56,
        alignItems: 'center',
        justifyContent: 'center',
    },
    promptSecondaryText: {
        color: '#94A3B8',
        fontSize: 16,
        fontWeight: '600',
    },
});
