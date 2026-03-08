import { useAuth } from '@/contexts/AuthContext';
import { useDatabase } from '@/contexts/DatabaseContext';
import { CallKeepService } from '@/services/CallKeepService';
import { CallService } from '@/services/CallService';
import { GlobalSigClient } from '@/services/GlobalSigClient';
import { PushNotificationService } from '@/services/PushNotificationService';
import { CallSignal, SigServer } from '@/services/SigServer';
import { UIEvents } from '@/utils/UIEvents';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    AppState,
    StyleSheet, Text, TouchableOpacity, View
} from 'react-native';
import RNCallKeep, { AudioRoute } from 'react-native-callkeep';
import InCallManager from 'react-native-incall-manager';
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { mediaDevices, MediaStream, RTCIceCandidate, RTCPeerConnection, RTCSessionDescription, RTCView } from 'react-native-webrtc';
type CallState = 'calling' | 'ringing' | 'connected' | 'ended';

export default function CallScreen() {
    // Note: using 'peerId' as the universal identifier (matches conversation screen)
    const { peerId, peerName, type: direction, offer: incomingOffer, callId: existingCallId, callType: paramCallType, autoAnswer } = useLocalSearchParams<{
        peerId: string; peerName: string; type?: string; incoming?: string; callId?: string; offer?: string; callType?: 'audio' | 'video'; autoAnswer?: string;
    }>();

    const { userId, name } = useAuth();
    const { db } = useDatabase();
    const router = useRouter();

    const [callState, setCallState] = useState<CallState>(direction === 'incoming' ? 'ringing' : 'calling');
    const [duration, setDuration] = useState(0);
    const [callId] = useState(existingCallId ?? `call-${Date.now()}`);
    const pcRef = useRef<RTCPeerConnection | null>(null);
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
    const callType = paramCallType || 'video';

    // Overall session type (audio vs video call layout)
    const [sessionType, setSessionType] = useState<'audio' | 'video'>(callType as 'audio' | 'video');

    // Local camera hardware state
    const [isLocalVideoEnabled, setIsLocalVideoEnabled] = useState(callType === 'video');

    const [isMicEnabled, setIsMicEnabled] = useState(true);
    const [isLocalFullScreen, setIsLocalFullScreen] = useState(false);
    const timerRef = useRef<any>(null);
    const iceCandidateBuffer = useRef<any[]>([]);
    const callTimeoutRef = useRef<any>(null);

    const [upgradeStatus, setUpgradeStatus] = useState<'idle' | 'requesting' | 'receiving'>('idle');

    // Advanced Audio Routing
    const [audioRoutes, setAudioRoutes] = useState<AudioRoute[]>([]);
    const [currentRoute, setCurrentRoute] = useState<AudioRoute | null>(null);
    const [manualRoute, setManualRoute] = useState<'earpiece' | 'speaker'>(callType === 'video' ? 'speaker' : 'earpiece');

    const ringPulse = useSharedValue(1);

    useEffect(() => {
        ringPulse.value = withRepeat(
            withSequence(
                withTiming(1.25, { duration: 700 }),
                withTiming(1, { duration: 700 })
            ), -1, false
        );
    }, []);

    const ringStyle = useAnimatedStyle(() => ({
        transform: [{ scale: ringPulse.value }],
        opacity: 2 - ringPulse.value,
    }));

    useEffect(() => {
        if (callState === 'connected') {
            timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);

            const reinforcementInterval = setInterval(() => {
                if (pcRef.current) {
                    console.log('[CallScreen] 🛡️ Reinforcing audio session in background...');
                    InCallManager.start({ media: callType === 'video' ? 'video' : 'audio' });
                }
            }, 10000);

            return () => {
                clearInterval(timerRef.current);
                clearInterval(reinforcementInterval);
            };
        }
        return () => clearInterval(timerRef.current);
    }, [callState]);

    const isInitialised = useRef(false);

    const cleanup = () => {
        console.log('[WebRTC] 🧹 Cleaning up WebRTC resources...');
        InCallManager.stop();
        PushNotificationService.dismissOngoingCallNotification();
        if (pcRef.current) {
            pcRef.current.close();
            pcRef.current = null;
        }
        if (localStream) {
            localStream.getTracks().forEach((track: any) => track.stop());
            setLocalStream(null);
        }
        setRemoteStream(null);
        CallKeepService.endCall(callId);
        CallService.setCallActive(false);
        CallService.setActiveCall(null);

        // Update call status in DB if call ended before connecting
        if (db && callState !== 'connected' && callState !== 'ended') {
            db.runAsync(
                'UPDATE call_history SET status = ? WHERE id = ?',
                ['missed', callId]
            ).catch(e => console.warn('[DB] Failed to update call status:', e));
        }
    };

    useEffect(() => {
        if (isInitialised.current) return;
        isInitialised.current = true;

        // Force Audio focus and Keep Alive
        InCallManager.start({ media: callType === 'video' ? 'video' : 'audio' });
        InCallManager.setKeepScreenOn(true);

        setupWebRTC();
        CallService.setCallActive(true);
        CallService.setActiveCall(callId);

        // 30 SEC TIMEOUT FOR OUTGOING CALLS
        if (direction === 'outgoing') {
            callTimeoutRef.current = setTimeout(() => {
                if (callState === 'calling' || callState === 'ringing') {
                    console.log('[CallScreen] ⏰ Connection timeout, ending call');
                    handleHangUp();
                }
            }, 30000);
        }

        // Listen for signals during the call
        const handleSignal = async (signal: CallSignal) => {
            if (callState === 'ended') return;
            console.log(`[CallScreen] 📥 Signal Received (${signal.type}) for ${signal.callId}`);
            if (signal.callId !== callId) {
                console.log(`[CallScreen] 🤫 Signal callId mismatch. Current: ${callId}, Incoming: ${signal.callId}`);
                return;
            }

            if (signal.type === 'call-offer' && callState === 'connected' && pcRef.current) {
                try {
                    console.log('[CallScreen] ♻️ Received renegotiation offer.');
                    await pcRef.current.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp! }));
                    const answer = await pcRef.current.createAnswer();
                    await pcRef.current.setLocalDescription(answer);
                    CallService.sendAnswer(peerId, {
                        type: 'call-answer',
                        callId,
                        from: name!,
                        fromId: userId!,
                        sdp: answer.sdp
                    });
                } catch (e) {
                    console.error('[WebRTC] Error renegotiating:', e);
                }
            } else if (signal.type === 'call-answer' && pcRef.current) {
                if ((pcRef.current as any).signalingState !== 'have-local-offer') {
                    console.log(`[CallScreen] 🤫 Ignoring duplicate or out-of-order call-answer. State: ${(pcRef.current as any).signalingState}`);
                    return;
                }
                try {
                    console.log('[CallScreen] ✅ Received call-answer. Setting remote description...');
                    await pcRef.current.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp! }));
                    setCallState('connected');

                    // Flush buffered candidates
                    console.log(`[CallScreen] 🧊 Flushing ${iceCandidateBuffer.current.length} buffered ICE candidates`);
                    while (iceCandidateBuffer.current.length > 0) {
                        const cand = iceCandidateBuffer.current.shift();
                        await pcRef.current.addIceCandidate(new RTCIceCandidate(cand));
                    }
                } catch (e) {
                    console.error('[WebRTC] Error setting answer:', e);
                }
            } else if (signal.type === 'ice-candidate' && pcRef.current) {
                try {
                    if (pcRef.current.remoteDescription) {
                        console.log(`[CallScreen] 📥 Adding ICE candidate: ${signal.candidate.candidate.substring(0, 30)}...`);
                        await pcRef.current.addIceCandidate(new RTCIceCandidate(signal.candidate));
                    } else {
                        console.log('[CallScreen] ⏳ Buffering incoming ICE candidate (remote description not set)');
                        iceCandidateBuffer.current.push(signal.candidate);
                    }
                } catch (e) {
                    console.warn('[WebRTC] Error adding ICE candidate:', e);
                }
            } else if (signal.type === 'call-upgrade-request') {
                console.log('[CallScreen] 🎥 Received video upgrade request');
                setUpgradeStatus('receiving');
            } else if (signal.type === 'call-upgrade-reject') {
                console.log('[CallScreen] ❌ Video upgrade rejected');
                setUpgradeStatus('idle');
            } else if (signal.type === 'call-upgrade-accept') {
                console.log('[CallScreen] ✅ Video upgrade accepted. Activating video and renegotiating...');
                setUpgradeStatus('idle');
                // The receiver has their video ready. Now we start ours and send the offer.
                await activateLocalVideoAndRenegotiate();
            } else if (signal.type === 'call-end' || signal.type === 'call-reject') {
                console.log(`[CallScreen] 🛑 Call ended via signal: ${signal.type}`);
                if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
                setCallState('ended');
                cleanup();
                setTimeout(() => {
                    if (router.canGoBack()) router.back();
                }, 1500);
            }
        };

        CallService.setCallEndedHandler((endedCallId?: string) => {
            if (endedCallId && endedCallId !== callId) {
                console.log(`[CallScreen] 🤫 Ignoring call-end for different callId: ${endedCallId}`);
                return;
            }
            console.log('[CallScreen] 👋 Call ended via handler');
            setCallState('ended');
            cleanup();
            setTimeout(() => {
                if (router.canGoBack()) router.back();
            }, 1500);
        });

        const sigSub = GlobalSigClient.on('signal', handleSignal);
        const tcpSub = SigServer.on('signal', handleSignal);

        // SYNC with System/Lock Screen actions
        const onSystemAnswer = () => {
            if (callState === 'ringing') handleAnswer();
        };
        const onSystemEnd = () => {
            handleHangUp();
        };
        const onCallRinging = () => {
            console.log('[CallService] 🔔 Peer is ringing!');
            setCallState('ringing');
            if (callTimeoutRef.current) {
                clearTimeout(callTimeoutRef.current);
                // Restart timeout with longer duration once it starts ringing
                callTimeoutRef.current = setTimeout(() => {
                    if (callState === 'ringing') {
                        handleHangUp();
                    }
                }, 45000);
            }
        };

        UIEvents.on('CALLKEEP_ANSWER', onSystemAnswer);
        UIEvents.on('CALLKEEP_END', onSystemEnd);
        CallService.setCallRingingHandler(onCallRinging);

        // Listen for Native Audio Route Changes
        const onAudioRouteChange = () => refreshAudioRoutes();
        RNCallKeep.addEventListener('didChangeAudioRoute', onAudioRouteChange);

        // Tell CallService we are active, to block duplicate incoming call screens for this callId
        CallService.setActiveCall(callId);

        // Tell System we are showing the screen
        if (direction === 'incoming') {
            CallKeepService.displayIncomingCall(callId, peerId, peerName);
            // Log incoming start
            if (db) {
                db.runAsync(
                    'INSERT OR REPLACE INTO call_history (id, peerId, peerName, timestamp, type, direction, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [callId, peerId, peerName, Date.now(), callType, 'incoming', 'ringing']
                ).catch(e => console.warn('[DB] Failed to log call history:', e));
            }
        } else {
            CallKeepService.startCall(callId, peerId, peerName);
            // Log outgoing start
            if (db) {
                db.runAsync(
                    'INSERT OR REPLACE INTO call_history (id, peerId, peerName, timestamp, type, direction, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [callId, peerId, peerName, Date.now(), callType, 'outgoing', 'calling']
                ).catch(e => console.warn('[DB] Failed to log call history:', e));
            }
        }

        // Initialize Audio Routes after a short delay to let CallKeep start the session
        setTimeout(refreshAudioRoutes, 1000);

        // AUTO ANSWER IF WOKEN FROM BACKGROUND
        if (autoAnswer === 'true' && callState === 'ringing') {
            console.log('[CallScreen] 🚀 Auto-answering call as requested');
            setTimeout(handleAnswer, 1500);
        }

        // AppState listener for background reinforcement
        const appStateSub = AppState.addEventListener('change', nextAppState => {
            if (nextAppState === 'background' || nextAppState === 'active') {
                if (pcRef.current) {
                    console.log(`[CallScreen] 🔄 App state changed to ${nextAppState}, reinforcing audio session...`);
                    // We use sessionType from the state if available, or callType as fallback
                    InCallManager.start({ media: callType === 'video' ? 'video' : 'audio' });
                }
            }
        });

        return () => {
            cleanup();
            appStateSub.remove();
            RNCallKeep.removeEventListener('didChangeAudioRoute');
            UIEvents.off('CALLKEEP_ANSWER', onSystemAnswer);
            UIEvents.off('CALLKEEP_END', onSystemEnd);
            CallService.setCallRingingHandler(() => { });
            GlobalSigClient.off('signal', handleSignal);
            SigServer.off('signal', handleSignal);
            CallService.setActiveCall(null);
        };
    }, []);

    useEffect(() => {
        if (callState === 'connected') {
            PushNotificationService.showOngoingCallNotification(peerName || 'Unknown', callType);
        }
    }, [callState]);

    const setupWebRTC = async () => {
        if (pcRef.current) return;

        const configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                {
                    urls: 'turn:openrelay.metered.ca:80',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: 'turn:openrelay.metered.ca:443',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: 'turn:freed.net:3478',
                    username: 'freed',
                    credential: 'webrtc_rocks'
                }
            ]
        };
        const pc = new RTCPeerConnection(configuration);
        pcRef.current = pc;

        (pc as any).onicecandidate = (event: any) => {
            if (event.candidate && userId && name) {
                console.log(`[WebRTC] 🧊 Generated ICE candidate: ${event.candidate.candidate.substring(0, 50)}...`);
                CallService.sendIceCandidate(peerId, {
                    type: 'ice-candidate',
                    callId,
                    from: name,
                    fromId: userId,
                    candidate: event.candidate
                });
            } else if (!event.candidate) {
                console.log('[WebRTC] 🧊 ICE Gathering Complete');
            }
        };

        (pc as any).onconnectionstatechange = () => {
            console.log('[WebRTC] PEER Connection State:', pc.connectionState);
            if (pc.connectionState === 'connected') {
                console.log(`[WebRTC] 🎉 Connection established with ${peerId}`);
                setCallState('connected');

                // Log to history
                if (db) {
                    db.runAsync(
                        'UPDATE call_history SET status = ? WHERE id = ?',
                        ['connected', callId]
                    ).catch(e => console.warn('[DB] Failed to update call status:', e));
                }

                // Reinforce session in background
                InCallManager.start({ media: callType === 'video' ? 'video' : 'audio' });
                RNCallKeep.setCurrentCallActive(callId);
            }
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                console.log(`[WebRTC] ❌ Connection failed or closed for ${peerId}`);
                setCallState('ended');
            }
        };

        (pc as any).oniceconnectionstatechange = () => {
            console.log('[WebRTC] ICE Connection State:', pc.iceConnectionState);
            if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
                setCallState('connected');

                // Backup keep-alive
                InCallManager.start({ media: callType === 'video' ? 'video' : 'audio' });
                RNCallKeep.setCurrentCallActive(callId);

                // CLEAR TIMEOUT if it's still running
                if (callTimeoutRef.current) {
                    clearTimeout(callTimeoutRef.current);
                    callTimeoutRef.current = null;
                }
            }
        };


        // Capture local stream
        let stream: MediaStream | null = null;
        try {
            console.log(`[WebRTC] Requesting local media (audio: true, video: ${isLocalVideoEnabled})...`);
            stream = await mediaDevices.getUserMedia({
                audio: true,
                video: isLocalVideoEnabled
            }) as MediaStream;

            console.log(`[WebRTC] 📸 Local stream obtained: ${stream.getVideoTracks().length} video, ${stream.getAudioTracks().length} audio`);
            setLocalStream(stream);

            const currentPc = pcRef.current;
            if (currentPc && (currentPc as any).signalingState !== 'closed') {
                stream.getTracks().forEach(track => {
                    if ((currentPc as any).signalingState !== 'closed') {
                        console.log(`[WebRTC] ➕ Adding local track to PC: ${track.kind}`);
                        currentPc.addTrack(track, stream!);
                    }
                });
            }
        } catch (err) {
            console.error('[WebRTC] getUserMedia error:', err);
        }

        // Handle remote stream
        (pc as any).ontrack = (event: any) => {
            console.log(`[WebRTC] 📡 Got remote track: ${event.track.kind} from ${peerId}`);
            if (event.streams && event.streams[0]) {
                console.log('[WebRTC] Setting remote stream from event');
                setRemoteStream(event.streams[0]);
            } else {
                console.log('[WebRTC] No stream in ontrack event, creating fallback stream');
                setRemoteStream(prev => {
                    if (prev) {
                        prev.addTrack(event.track);
                        return new MediaStream(prev.getTracks());
                    }
                    const newStream = new MediaStream();
                    newStream.addTrack(event.track);
                    return newStream;
                });
            }
        };

        // Start Call if Outgoing
        if (direction === 'outgoing' && userId && name && pcRef.current && (pcRef.current as any).signalingState !== 'closed') {
            try {
                console.log(`[WebRTC] 📞 Creating offer for ${peerId}...`);
                const offer = await pcRef.current.createOffer({});
                if ((pcRef.current as any).signalingState === 'closed') return;
                await pcRef.current.setLocalDescription(offer);

                CallService.sendOffer(peerId, {
                    type: 'call-offer',
                    callId,
                    from: name,
                    fromId: userId,
                    sdp: offer.sdp,
                    callType: callType as any
                });

                // RECORD this outgoing attempt to prevent loops (glare protection)
                CallService.recordOutgoingCall(peerId);

                // Log to history
                if (db) {
                    db.runAsync(
                        'INSERT OR REPLACE INTO call_history (id, peerId, peerName, timestamp, type, direction, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
                        [callId, peerId, peerName, Date.now(), callType, 'outgoing', 'calling']
                    ).catch(e => console.warn('[DB] Failed to log call history:', e));
                }
            } catch (err) {
                console.error('[WebRTC] Error creating offer:', err);
            }
        }
    };


    const formatDuration = (s: number) => {
        const m = Math.floor(s / 60).toString().padStart(2, '0');
        const sec = (s % 60).toString().padStart(2, '0');
        return `${m}:${sec}`;
    };

    const handleHangUp = () => {
        if (callState === 'ended') return;
        console.log('[CallScreen] ☎️ Hang up requested');
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        if (userId && name) {
            CallService.endCall(peerId, callId, userId, name);
        }
        setCallState('ended');
        cleanup();
        setTimeout(() => {
            if (router.canGoBack()) router.back();
        }, 1200);
    };

    const handleAnswer = async () => {
        if (!pcRef.current || !incomingOffer || !userId || !name) return;
        console.log(`[CallScreen] 📞 Answering call from ${peerId}...`);

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

        if ((pcRef.current as any).signalingState === 'closed') return;
        await pcRef.current.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: incomingOffer }));

        if ((pcRef.current as any).signalingState === 'closed') return;
        const answer = await pcRef.current.createAnswer();
        await pcRef.current.setLocalDescription(answer);

        // Flush buffered candidates AFTER local description is set
        console.log(`[CallScreen] 🧊 Flushing ${iceCandidateBuffer.current.length} buffered ICE candidates`);
        while (iceCandidateBuffer.current.length > 0) {
            const cand = iceCandidateBuffer.current.shift();
            if (pcRef.current && (pcRef.current as any).signalingState !== 'closed') {
                await pcRef.current.addIceCandidate(new RTCIceCandidate(cand));
            }
        }

        CallService.sendAnswer(peerId, {
            type: 'call-answer',
            callId,
            from: name,
            fromId: userId,
            sdp: answer.sdp
        });

        setCallState('connected');
    };

    const handleDecline = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        if (userId && name) {
            CallService.sendSignal(peerId, {
                type: 'call-reject',
                callId,
                from: name,
                fromId: userId
            });
        }
        router.back();
    };

    const activateLocalVideoAndRenegotiate = async () => {
        setSessionType('video');
        setIsLocalVideoEnabled(true);
        let stream = localStream;
        try {
            if (!stream || stream.getVideoTracks().length === 0) {
                console.log('[CallScreen] 🎥 Upgrading to Video. Fetching video stream...');
                const videoStream = await mediaDevices.getUserMedia({ video: true }) as MediaStream;
                const videoTrack = videoStream.getVideoTracks()[0];
                if (videoTrack) {
                    if (stream) {
                        stream.addTrack(videoTrack);
                    } else {
                        stream = videoStream;
                        setLocalStream(stream);
                    }
                    if (pcRef.current && (pcRef.current as any).signalingState !== 'closed') {
                        pcRef.current.addTrack(videoTrack, stream);

                        const offer = await pcRef.current.createOffer({});
                        await pcRef.current.setLocalDescription(offer);
                        CallService.sendOffer(peerId, {
                            type: 'call-offer',
                            callId,
                            from: name!,
                            fromId: userId!,
                            sdp: offer.sdp,
                            callType: 'video'
                        });
                    }
                }
            } else {
                stream.getVideoTracks().forEach(t => t.enabled = true);
            }
        } catch (e) {
            console.error('[CallScreen] Error activating video:', e);
            setIsLocalVideoEnabled(false);
        }
    };

    const toggleVideo = async () => {
        if (!pcRef.current || !userId || !name) return;

        if (sessionType === 'video') {
            // Turning OFF video -> Mute local camera, but KEEP video session layout
            const nextState = !isLocalVideoEnabled;
            setIsLocalVideoEnabled(nextState);
            if (localStream) {
                localStream.getVideoTracks().forEach(t => t.enabled = nextState);
            }
        } else {
            // Turning ON video from Audio call -> send request
            setUpgradeStatus('requesting');
            CallService.sendSignal(peerId, {
                type: 'call-upgrade-request',
                callId,
                from: name,
                fromId: userId
            });
        }
    };

    const acceptVideoUpgrade = async () => {
        setUpgradeStatus('idle');
        setSessionType('video');
        setIsLocalVideoEnabled(true);

        let stream = localStream;
        try {
            if (!stream || stream.getVideoTracks().length === 0) {
                const videoStream = await mediaDevices.getUserMedia({ video: true }) as MediaStream;
                const videoTrack = videoStream.getVideoTracks()[0];
                if (videoTrack) {
                    if (stream) {
                        stream.addTrack(videoTrack);
                    } else {
                        stream = videoStream;
                        setLocalStream(stream);
                    }
                    if (pcRef.current && (pcRef.current as any).signalingState !== 'closed') {
                        pcRef.current.addTrack(videoTrack, stream);
                    }
                }
            } else {
                stream.getVideoTracks().forEach(t => t.enabled = true);
            }

            // Send accept ONLY after camera is captured and track is added
            CallService.sendSignal(peerId, {
                type: 'call-upgrade-accept',
                callId,
                from: name!,
                fromId: userId!
            });
        } catch (e) {
            console.error('[CallScreen] Error accepting video upgrade:', e);
            // Revert on fail
            setSessionType('audio');
            setIsLocalVideoEnabled(false);
        }
    };

    const rejectVideoUpgrade = () => {
        setUpgradeStatus('idle');
        CallService.sendSignal(peerId, {
            type: 'call-upgrade-reject',
            callId,
            from: name!,
            fromId: userId!
        });
    };

    const switchCamera = () => {
        if (!localStream) return;
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack && typeof (videoTrack as any)._switchCamera === 'function') {
            (videoTrack as any)._switchCamera();
        }
    };

    const refreshAudioRoutes = async () => {
        try {
            const routes: any = await RNCallKeep.getAudioRoutes();
            if (routes && Array.isArray(routes) && routes.length > 0) {
                setAudioRoutes(routes);
                const active = routes.find(r => r.selected) || routes[0];
                setCurrentRoute(active);
                console.log('[CallScreen] 🎧 Audio Routes updated:', routes);
            } else {
                console.log('[CallScreen] 🎧 Audio Routes empty, manual mode active');
            }
        } catch (e) {
            console.error('[CallScreen] Error fetching audio routes:', e);
        }
    };

    const cycleAudioRoute = async () => {
        // Fallback for Android selfManaged or empty routes
        if (audioRoutes.length <= 1) {
            const nextRoute = manualRoute === 'speaker' ? 'earpiece' : 'speaker';
            setManualRoute(nextRoute);

            console.log(`[CallScreen] 🔄 Switching manual audio route to: ${nextRoute}`);

            // Force hardware routing using InCallManager
            if (nextRoute === 'speaker') {
                InCallManager.setForceSpeakerphoneOn(true);
            } else {
                InCallManager.setForceSpeakerphoneOn(false);
            }

            // Still tell CallKeep just in case UI needs it
            RNCallKeep.toggleAudioRouteSpeaker(callId, nextRoute === 'speaker');
            return;
        }

        // Native System Implementation
        let currentIndex = audioRoutes.findIndex(r => r.name === currentRoute?.name);
        if (currentIndex === -1) currentIndex = 0;

        const nextIndex = (currentIndex + 1) % audioRoutes.length;
        const nextRoute = audioRoutes[nextIndex];

        try {
            console.log(`[CallScreen] 🔄 Switching native audio route to: ${nextRoute.type || nextRoute.name}`);
            await RNCallKeep.setAudioRoute(callId, nextRoute.name);

            const isSpeaker = nextRoute.type && nextRoute.type.toLowerCase().includes('speaker');
            RNCallKeep.toggleAudioRouteSpeaker(callId, !!isSpeaker);

            // Force hardware routing as backup
            InCallManager.setForceSpeakerphoneOn(!!isSpeaker);

        } catch (e) {
            console.error('[CallScreen] Failed to set native audio route:', e);
        }
    };

    // Helper to get correct icon for current route
    const getAudioRouteIcon = () => {
        if (audioRoutes.length <= 1) {
            return manualRoute === 'speaker' ? "volume-high" : "phone-portrait-outline";
        }

        if (!currentRoute) return "volume-high"; // fallback
        const type = (currentRoute.type || "").toLowerCase();

        if (type.includes('bluetooth') || type.includes('headset')) return "bluetooth";
        if (type.includes('speaker')) return "volume-high";
        return "phone-portrait-outline"; // Earpiece
    };

    return (
        <View style={styles.container}>
            {/* FULL SCREEN MAIN VIEW */}
            {callState === 'connected' && sessionType === 'video' && (isLocalFullScreen ? localStream : remoteStream) ? (
                <RTCView
                    streamURL={isLocalFullScreen ? localStream!.toURL() : remoteStream!.toURL()}
                    style={StyleSheet.absoluteFill}
                    objectFit="cover"
                />
            ) : (
                <>
                    <View style={styles.glow1} />
                    <View style={styles.glow2} />
                    <BlurView intensity={90} tint="dark" style={StyleSheet.absoluteFill} />
                </>
            )}

            {/* PIP (PICTURE IN PICTURE) THUMBNAIL */}
            {callState === 'connected' && sessionType === 'video' && (
                <TouchableOpacity
                    style={styles.localVideoContainer}
                    activeOpacity={0.8}
                    onPress={() => setIsLocalFullScreen(prev => !prev)}
                >
                    {/* Render local stream only if local video is actually enabled */}
                    {(isLocalFullScreen ? remoteStream : (isLocalVideoEnabled ? localStream : null)) ? (
                        <RTCView
                            streamURL={(isLocalFullScreen ? remoteStream! : localStream!).toURL()}
                            style={styles.localVideo}
                            objectFit="cover"
                            zOrder={1}
                        />
                    ) : (
                        <View style={[styles.localVideo, { backgroundColor: '#1e293b', justifyContent: 'center', alignItems: 'center' }]}>
                            <Ionicons name={isLocalFullScreen ? "person" : "videocam-off"} size={40} color="#475569" />
                        </View>
                    )}
                </TouchableOpacity>
            )}

            <SafeAreaView style={styles.safeArea}>
                <Animated.View entering={FadeIn.duration(500)} style={styles.content}>
                    {/* AVATAR FOR AUDIO CALLS OR RINGING */}
                    {((!remoteStream && !isLocalFullScreen) || callState !== 'connected' || upgradeStatus === 'receiving' || sessionType === 'audio') && (
                        <View style={styles.avatarContainer}>
                            {(callState === 'calling' || callState === 'ringing' || upgradeStatus === 'receiving') && (
                                <Animated.View style={[styles.avatarRing, ringStyle]} />
                            )}
                            <View style={styles.avatar}>
                                <Text style={styles.avatarText}>{(peerName || 'P')[0].toUpperCase()}</Text>
                            </View>
                        </View>
                    )}

                    {/* PEER NAME */}
                    <Text style={[
                        styles.peerName,
                        ((remoteStream && !isLocalFullScreen) || (localStream && isLocalFullScreen)) && callState === 'connected' && upgradeStatus !== 'receiving' && styles.peerNameOverlay
                    ]}>
                        {peerName ?? 'Unknown'}
                    </Text>

                    {/* STATE TEXT / DURATION */}
                    <View style={[
                        styles.stateRow,
                        ((remoteStream && !isLocalFullScreen) || (localStream && isLocalFullScreen)) && callState === 'connected' && upgradeStatus !== 'receiving' && styles.stateRowOverlay
                    ]}>
                        {callState === 'calling' && <Text style={styles.stateText}>{callType === 'audio' ? 'Calling Audio…' : 'Calling Video…'}</Text>}
                        {callState === 'ringing' && (
                            <Text style={styles.stateText}>
                                {direction === 'incoming'
                                    ? (callType === 'audio' ? 'Incoming Audio…' : 'Incoming Video…')
                                    : 'Ringing…'}
                            </Text>
                        )}
                        {upgradeStatus === 'receiving' && <Text style={styles.stateText}>Incoming Video Call</Text>}
                        {(callState === 'connected' && upgradeStatus !== 'receiving') && (
                            <>
                                <View style={styles.connectedDot} />
                                <Text style={styles.stateText}>{formatDuration(duration)}</Text>
                            </>
                        )}
                        {callState === 'ended' && <Text style={[styles.stateText, { color: '#ef4444' }]}>Call Ended</Text>}
                    </View>



                    {/* CONTROLS */}
                    <Animated.View entering={FadeInDown.delay(300).springify()} style={styles.controls}>
                        {(callState === 'ringing' || upgradeStatus === 'receiving') ? (
                            <View style={styles.btnRow}>
                                <TouchableOpacity style={[styles.btn, styles.btnDecline, styles.btnLarge]} onPress={upgradeStatus === 'receiving' ? rejectVideoUpgrade : handleDecline}>
                                    <Ionicons name="close" size={34} color="#fff" />
                                </TouchableOpacity>
                                <TouchableOpacity style={[styles.btn, styles.btnAnswer, styles.btnLarge]} onPress={upgradeStatus === 'receiving' ? acceptVideoUpgrade : handleAnswer}>
                                    <Ionicons name={(callType === 'audio' && upgradeStatus !== 'receiving') ? "call" : "videocam"} size={34} color="#fff" />
                                </TouchableOpacity>
                            </View>
                        ) : callState === 'connected' ? (
                            <View style={styles.unifiedControls}>
                                <TouchableOpacity
                                    style={[styles.smallBtn, !isMicEnabled && styles.btnDisabled]}
                                    onPress={() => {
                                        const next = !isMicEnabled;
                                        setIsMicEnabled(next);
                                        localStream?.getAudioTracks().forEach(t => t.enabled = next);
                                    }}
                                >
                                    <Ionicons name={isMicEnabled ? "mic" : "mic-off"} size={24} color="#fff" />
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={[styles.smallBtn, (!isLocalVideoEnabled && upgradeStatus !== 'requesting') && styles.btnDisabled]}
                                    onPress={toggleVideo}
                                    disabled={upgradeStatus === 'requesting'}
                                >
                                    {upgradeStatus === 'requesting' ? (
                                        <ActivityIndicator color="#fff" size="small" />
                                    ) : (
                                        <Ionicons name={isLocalVideoEnabled ? "videocam" : "videocam-off"} size={24} color="#fff" />
                                    )}
                                </TouchableOpacity>

                                {/* AUDIO ROUTE TOGGLE */}
                                <TouchableOpacity
                                    style={styles.smallBtn}
                                    onPress={cycleAudioRoute}
                                >
                                    <Ionicons name={getAudioRouteIcon() as any} size={24} color="#fff" />
                                </TouchableOpacity>

                                {isLocalVideoEnabled && (
                                    <TouchableOpacity
                                        style={styles.smallBtn}
                                        onPress={switchCamera}
                                    >
                                        <Ionicons name="camera-reverse" size={24} color="#fff" />
                                    </TouchableOpacity>
                                )}

                                <TouchableOpacity style={[styles.smallBtn, styles.btnDecline, { width: 60, height: 60, borderRadius: 30 }]} onPress={handleHangUp}>
                                    <Ionicons name="call" size={28} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
                                </TouchableOpacity>
                            </View>
                        ) : (
                            <TouchableOpacity style={[styles.btn, styles.btnDecline]} onPress={handleHangUp}>
                                <Ionicons name="call" size={28} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
                            </TouchableOpacity>
                        )}
                    </Animated.View>
                </Animated.View>
            </SafeAreaView>
        </View >
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#020617' },
    safeArea: { flex: 1 },
    glow1: {
        position: 'absolute', width: 300, height: 300,
        borderRadius: 150, backgroundColor: '#3b82f6',
        top: -100, left: -80, opacity: 0.2,
    },
    glow2: {
        position: 'absolute', width: 250, height: 250,
        borderRadius: 125, backgroundColor: '#8b5cf6',
        bottom: -80, right: -60, opacity: 0.2,
    },
    content: {
        flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40,
    },
    avatarContainer: { position: 'relative', alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
    avatarRing: {
        position: 'absolute', width: 130, height: 130, borderRadius: 65,
        borderWidth: 2, borderColor: 'rgba(59,130,246,0.5)',
    },
    avatar: {
        width: 100, height: 100, borderRadius: 50,
        backgroundColor: 'rgba(59,130,246,0.2)',
        alignItems: 'center', justifyContent: 'center',
        borderWidth: 2, borderColor: 'rgba(59,130,246,0.5)',
    },
    avatarText: { color: '#60a5fa', fontSize: 40, fontWeight: '800' },
    peerName: { color: '#f8fafc', fontSize: 30, fontWeight: '800', marginBottom: 12 },
    stateRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 60 },
    stateText: { color: '#94a3b8', fontSize: 16, fontWeight: '500' },
    connectedDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#22C55E',
        marginRight: 8,
    },
    localVideoContainer: {
        position: 'absolute',
        top: 60,
        right: 20,
        width: 120,
        height: 180,
        borderRadius: 16,
        overflow: 'hidden',
        borderWidth: 2,
        borderColor: 'rgba(255, 255, 255, 0.2)',
        backgroundColor: '#000',
        zIndex: 10,
    },
    localVideo: {
        flex: 1,
    },
    peerNameOverlay: {
        fontSize: 28,
        textShadowColor: 'rgba(0, 0, 0, 0.75)',
        textShadowOffset: { width: -1, height: 1 },
        textShadowRadius: 10,
    },
    stateRowOverlay: {
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
        paddingHorizontal: 16,
        paddingVertical: 4,
        borderRadius: 20,
    },
    mediaToggles: {
        flexDirection: 'row',
        gap: 20,
        marginBottom: 40,
        justifyContent: 'center',
    },
    smallBtn: {
        width: 50,
        height: 50,
        borderRadius: 25,
        backgroundColor: 'rgba(255, 255, 255, 0.15)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    btnDisabled: {
        backgroundColor: '#ef4444',
    },
    controls: {
        width: '100%',
        alignItems: 'center',
    },
    unifiedControls: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        paddingHorizontal: 20,
        backgroundColor: 'rgba(15, 23, 42, 0.6)',
        paddingVertical: 12,
        borderRadius: 40,
        marginBottom: 20
    },
    btnRow: {
        flexDirection: 'row',
        width: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 40
    },
    btn: {
        width: 72, height: 72, borderRadius: 36,
        alignItems: 'center', justifyContent: 'center',
    },
    btnSmall: {
        width: 56, height: 56, borderRadius: 28,
        backgroundColor: 'rgba(30,41,59,0.8)',
    },
    btnLarge: { width: 80, height: 80, borderRadius: 40 },
    btnSmall2: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
    btnAnswer: { backgroundColor: '#22c55e' },
    btnDecline: { backgroundColor: '#ef4444' },
    upgradeCard: {
        backgroundColor: 'rgba(30,41,59,0.9)',
        padding: 20,
        borderRadius: 20,
        alignItems: 'center',
        marginBottom: 30,
        borderWidth: 1,
        borderColor: 'rgba(59,130,246,0.3)',
    },
    upgradeText: { color: '#f8fafc', fontSize: 16, fontWeight: '600', marginBottom: 15 },
    upgradeBtns: { flexDirection: 'row', gap: 20 },
});
