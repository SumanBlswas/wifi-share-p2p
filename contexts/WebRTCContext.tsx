import { CallService } from '@/services/CallService';
import { GlobalSigClient } from '@/services/GlobalSigClient';
import { CallSignal, SigServer } from '@/services/SigServer';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { RTCIceCandidate, RTCPeerConnection, RTCSessionDescription } from 'react-native-webrtc';
import { useAuth } from './AuthContext';
import { useDatabase } from './DatabaseContext';

type WEBRTCContextType = {
    peers: Record<string, RTCPeerConnection>;
    connectToPeer: (peerId: string) => Promise<void>;
    sendMessage: (peerId: string, message: string) => Promise<boolean>;
    sendFile: (peerId: string, fileUri: string, mimeType: string) => Promise<boolean>;
    isOnline: boolean;
};

const WebRTCContext = createContext<WEBRTCContextType>({
    peers: {},
    connectToPeer: async () => { },
    sendMessage: async () => false,
    sendFile: async () => false,
    isOnline: false,
});

export function useWebRTC() {
    return useContext(WebRTCContext);
}

export function WebRTCProvider({ children }: { children: React.ReactNode }) {
    const { userId, name: userName } = useAuth();
    const { db } = useDatabase();
    const [peers, setPeers] = useState<Record<string, RTCPeerConnection>>({});
    const [dataChannels, setDataChannels] = useState<Record<string, any>>({});
    const activePeers = useRef<Record<string, RTCPeerConnection>>({});
    const dataChannelsRef = useRef<Record<string, any>>({});
    const candidateBuffers = useRef<Record<string, any[]>>({});
    const [isOnline, setIsOnline] = useState(false);

    useEffect(() => {
        if (userId) {
            // Monitor Online Status
            const updateStatus = () => setIsOnline(GlobalSigClient.isOnline() || SigServer.isRunning());
            GlobalSigClient.on('online', updateStatus);

            // Listen for signals (Global + Local via CallService dispatcher or individual servers)
            const handleSignal = async (signal: CallSignal) => {
                const { type, fromId, fromIp, sdp, candidate, callId } = signal;
                if (!fromId) return;

                // CRITICAL: WebRTCContext only handles 'data-sync' signals.
                // Video calls are handled individually in the CallScreen to avoid interference.
                if (callId !== 'data-sync' && callId !== 'identity') {
                    return;
                }

                let pc = activePeers.current[fromId];

                if (type === 'call-offer' && sdp) {
                    // AUTO-ANSWER for Data Sync
                    if (signal.callId === 'data-sync') {
                        console.log(`[WebRTC-Sync] 📥 Received data-sync offer from ${fromId}`);
                        const pc = createPeerConnection(fromId);
                        activePeers.current[fromId] = pc;
                        setPeers({ ...activePeers.current });

                        (pc as any).ondatachannel = (event: any) => {
                            console.log(`[WebRTC-Sync] 🔌 Data channel received from ${fromId}`);
                            setupDataChannel(fromId, event.channel);
                        };

                        await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
                        const answer = await pc.createAnswer();
                        await pc.setLocalDescription(answer);

                        // FLUSH CANDIDATES
                        if (candidateBuffers.current[fromId]) {
                            console.log(`[WebRTC-Sync] 🧊 Flushing ${candidateBuffers.current[fromId].length} buffered ICE candidates for ${fromId}`);
                            for (const cand of candidateBuffers.current[fromId]) {
                                await pc.addIceCandidate(new RTCIceCandidate(cand));
                            }
                            candidateBuffers.current[fromId] = [];
                        }

                        CallService.sendSignal(fromId, {
                            type: 'call-answer',
                            callId: 'data-sync',
                            from: userName || 'User',
                            fromId: userId,
                            sdp: answer.sdp
                        }); // No peerIp here for chat sync
                    }
                } else if (type === 'call-answer') {
                    if (pc && sdp) {
                        console.log(`[WebRTC-Sync] ✅ Received data-sync answer from ${fromId}`);
                        await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));

                        // FLUSH CANDIDATES
                        if (candidateBuffers.current[fromId]) {
                            console.log(`[WebRTC-Sync] 🧊 Flushing ${candidateBuffers.current[fromId].length} buffered ICE candidates for ${fromId}`);
                            for (const cand of candidateBuffers.current[fromId]) {
                                await pc.addIceCandidate(new RTCIceCandidate(cand));
                            }
                            candidateBuffers.current[fromId] = [];
                        }
                    }
                } else if (type === 'ice-candidate') {
                    if (pc && candidate) {
                        try {
                            if (pc.remoteDescription) {
                                await pc.addIceCandidate(new RTCIceCandidate(candidate));
                            } else {
                                console.log('[WebRTC-Sync] ⏳ Buffering incoming ICE candidate (remote description not set)');
                                if (!candidateBuffers.current[fromId]) candidateBuffers.current[fromId] = [];
                                candidateBuffers.current[fromId].push(candidate);
                            }
                        } catch (e) {
                            console.warn('[WebRTC-Sync] ICE candidate error:', e);
                        }
                    }
                }
            };

            SigServer.on('signal', handleSignal);
            GlobalSigClient.on('signal', handleSignal);

            return () => {
                SigServer.off('signal', handleSignal);
                GlobalSigClient.off('signal', handleSignal);
                GlobalSigClient.off('online', updateStatus);
            };
        }
    }, [userId]);

    const createPeerConnection = (peerId: string) => {
        console.log(`[WebRTC-Sync] Creating PeerConnection for ${peerId}`);
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

        (pc as any).onicecandidate = (event: any) => {
            if (event.candidate && userId) {
                CallService.sendSignal(peerId, {
                    type: 'ice-candidate',
                    callId: 'data-sync',
                    from: userName || 'User',
                    fromId: userId,
                    candidate: event.candidate
                }); // Always Global for now as per user request
            }
        };

        (pc as any).onconnectionstatechange = () => {
            console.log(`[WebRTC-Sync] ${peerId} Connection State: ${pc.connectionState}`);
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                delete activePeers.current[peerId];
                delete dataChannelsRef.current[peerId];
                delete candidateBuffers.current[peerId];
                setPeers({ ...activePeers.current });
                setDataChannels({ ...dataChannelsRef.current });
            }
        };

        return pc;
    };

    const connectToPeer = async (peerId: string) => {
        if (activePeers.current[peerId]) {
            console.log(`[WebRTC-Sync] Connection already exists for ${peerId}`);
            return;
        }

        try {
            console.log(`[WebRTC-Sync] 🚀 Initiating data-sync connection to ${peerId}`);
            const pc = createPeerConnection(peerId);
            const dc = pc.createDataChannel('p2p-data');
            setupDataChannel(peerId, dc);

            const offer = await pc.createOffer({});
            await pc.setLocalDescription(offer);

            if (userId) {
                await CallService.sendSignal(peerId, {
                    type: 'call-offer',
                    callId: 'data-sync',
                    from: userName || 'User',
                    fromId: userId,
                    sdp: offer.sdp
                }); // Always Global for chat
            }

            activePeers.current[peerId] = pc;
            setPeers({ ...activePeers.current });
        } catch (e) {
            console.error('[WebRTC-Sync] Failed to connect to peer', e);
        }
    };

    const setupDataChannel = (peerId: string, dc: any) => {
        // Store DC immediately to track state during connecting
        dataChannelsRef.current[peerId] = dc;

        dc.onopen = () => {
            console.log(`[WebRTC-Sync] 🟢 Data channel open with ${peerId}`);
            setDataChannels({ ...dataChannelsRef.current });
        };
        dc.onclose = () => {
            console.log(`[WebRTC-Sync] 🔴 Data channel closed with ${peerId}`);
            delete dataChannelsRef.current[peerId];
            setDataChannels({ ...dataChannelsRef.current });
        };
        dc.onmessage = async (event: any) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'text' && data.text && db && userId) {
                    const msgId = Math.random().toString(36).substring(7);
                    const timestamp = Date.now();

                    await db.runAsync(
                        'INSERT INTO messages (id, senderId, receiverId, content, timestamp, type, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
                        [msgId, peerId, userId, data.text, timestamp, 'text', 'received']
                    );

                    await db.runAsync(
                        'INSERT OR REPLACE INTO contacts (id, name, phone) VALUES (?, ?, ?)',
                        [peerId, data.fromName || 'P2P Peer', peerId]
                    );
                }
            } catch (e) {
                console.error('Error handling data channel message', e);
            }
        };
    };

    const sendMessage = async (peerId: string, message: string) => {
        let dc = dataChannelsRef.current[peerId];

        // If no DC or not open, try to connect first
        if (!dc || dc.readyState !== 'open') {
            if (!dc) {
                console.log(`[WebRTC-Sync] No Data channel for ${peerId}, initiating connection...`);
                await connectToPeer(peerId);
            } else {
                console.log(`[WebRTC-Sync] Data channel for ${peerId} exists (state: ${dc.readyState}), waiting for 'open'...`);
            }

            // Wait up to 15 seconds for it to open
            let attempts = 0;
            while (attempts < 30) { // 30 attempts * 500ms = 15 seconds
                await new Promise(r => setTimeout(r, 500));
                dc = dataChannelsRef.current[peerId];
                if (dc?.readyState === 'open') break;
                if (!activePeers.current[peerId]) {
                    console.log(`[WebRTC-Sync] Connection to ${peerId} failed during wait.`);
                    break;
                }
                attempts++;
            }
        }

        if (dc?.readyState === 'open') {
            dc.send(JSON.stringify({
                type: 'text',
                text: message,
                fromName: userName,
                fromId: userId
            }));
            return true;
        } else {
            console.error(`[WebRTC-Sync] Failed to deliver message to ${peerId} (readyState: ${dc?.readyState || 'none'})`);
        }
        return false;
    };

    const sendFile = async (peerId: string, fileUri: string, mimeType: string) => {
        return false;
    };

    return (
        <WebRTCContext.Provider value={{ peers, connectToPeer, sendMessage, sendFile, isOnline }}>
            {children}
        </WebRTCContext.Provider>
    );
}
