import { useAuth } from "@/contexts/AuthContext";
import { useUI } from "@/contexts/UIContext";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
    Alert,
    Dimensions,
    Linking,
    Modal,
    NativeModules,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import Animated, {
    FadeIn,
    FadeInUp,
    SlideInDown,
    SlideOutDown,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

type Section = {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  items: SettingItem[];
};

type SettingItem =
  | {
      type: "toggle";
      key: string;
      label: string;
      subtitle?: string;
      icon: keyof typeof Ionicons.glyphMap;
    }
  | {
      type: "info";
      label: string;
      value: string;
      icon: keyof typeof Ionicons.glyphMap;
      copyable?: boolean;
    }
  | {
      type: "action";
      label: string;
      subtitle?: string;
      color?: string;
      icon: keyof typeof Ionicons.glyphMap;
      onPress: () => void;
    }
  | {
      type: "select";
      label: string;
      value: string;
      options: string[];
      icon: keyof typeof Ionicons.glyphMap;
      onSelect: (v: any) => void;
    };

export default function SettingsScreen() {
  const router = useRouter();
  const { userId, name, phoneNumber, profileImage, updateProfile, logout } =
    useAuth();
  const { pageAnimation, setPageAnimation } = useUI();
  const { SystemPermissions } = NativeModules;
  const [keepAwake, setKeepAwake] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [biometricLock, setBiometricLock] = useState(false);
  const [betaFeatures, setBetaFeatures] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(name ?? "");
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    const load = async () => {
      const [ka, notif, bio, beta] = await Promise.all([
        AsyncStorage.getItem("@keepAwake"),
        AsyncStorage.getItem("@notifications"),
        AsyncStorage.getItem("@biometricLock"),
        AsyncStorage.getItem("@betaFeatures"),
      ]);
      setKeepAwake(ka === "true");
      setNotifications(notif !== "false");
      setBiometricLock(bio === "true");
      setBetaFeatures(beta === "true");
    };
    load();
  }, []);

  const toggle = async (
    key: string,
    value: boolean,
    setter: (v: boolean) => void,
  ) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setter(value);
    await AsyncStorage.setItem(key, value.toString());

    if (key === "@keepAwake") {
      if (value) await activateKeepAwakeAsync();
      else deactivateKeepAwake();
    }
  };

  const handleSaveName = async () => {
    if (nameInput.trim().length < 2) {
      Alert.alert("Invalid Name", "Name must be at least 2 characters.");
      return;
    }
    await updateProfile(nameInput.trim(), profileImage ?? undefined);
    setEditingName(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const pickFromCamera = async () => {
    setShowPicker(false);
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Denied", "Camera access is required.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.4,
      base64: true,
    });
    processImageResult(result);
  };

  const pickFromGallery = async () => {
    setShowPicker(false);
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Denied", "Gallery access is required.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.4,
      base64: true,
    });
    processImageResult(result);
  };

  const processImageResult = async (result: ImagePicker.ImagePickerResult) => {
    if (!result.canceled && result.assets[0].uri) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const base64Image = `data:image/jpeg;base64,${result.assets[0].base64}`;
      await updateProfile(name ?? "User", base64Image);
    }
  };

  const handleLogout = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          await logout();
        },
      },
    ]);
  };

  const handleOverlayPermission = async () => {
    if (Platform.OS !== "android") {
      Alert.alert(
        "Not Available",
        "Floating popups are only supported on Android.",
      );
      return;
    }
    if (
      !SystemPermissions?.openOverlaySettings ||
      !SystemPermissions?.canDrawOverlays
    ) {
      Alert.alert(
        "Update Required",
        "Please reinstall the app to enable system permission settings.",
      );
      return;
    }
    const canDraw = await SystemPermissions.canDrawOverlays();
    if (canDraw) {
      Alert.alert("Already Enabled", "Floating popups are already enabled.");
      return;
    }
    SystemPermissions.openOverlaySettings();
  };

  const handleBatteryOptimization = async () => {
    if (Platform.OS !== "android") {
      Alert.alert(
        "Not Available",
        "Battery optimization controls are only supported on Android.",
      );
      return;
    }
    if (
      !SystemPermissions?.requestIgnoreBatteryOptimizations ||
      !SystemPermissions?.isIgnoringBatteryOptimizations
    ) {
      Alert.alert(
        "Update Required",
        "Please reinstall the app to enable battery optimization settings.",
      );
      return;
    }
    const ignored = await SystemPermissions.isIgnoringBatteryOptimizations();
    if (ignored) {
      Alert.alert(
        "Already Enabled",
        "Battery optimization is already disabled for this app.",
      );
      return;
    }
    SystemPermissions.requestIgnoreBatteryOptimizations();
  };

  const shortId = userId
    ? userId.startsWith("@")
      ? userId
      : `@${userId}`
    : "—";

  const sections: Section[] = [
    {
      title: "Connectivity",
      icon: "wifi-outline",
      color: "#0ea5e9",
      items: [
        {
          type: "info",
          icon: "call-outline",
          label: "Phone Number",
          value: phoneNumber ?? "—",
        },
        {
          type: "info",
          icon: "finger-print-outline",
          label: "Node ID",
          value: shortId,
          copyable: true,
        },
        {
          type: "action",
          icon: "share-social-outline",
          label: "Nearby Share",
          subtitle: "Discover devices on same WiFi",
          onPress: () => router.push("/nearby-share"),
        },
        {
          type: "toggle",
          icon: "notifications-outline",
          key: "@notifications",
          label: "Push Notifications",
          subtitle: "Global call alerts",
        },
      ],
    },
    {
      title: "Experience",
      icon: "sparkles-outline",
      color: "#8b5cf6",
      items: [
        {
          type: "select",
          icon: "layers-outline",
          label: "Page Animation",
          value: pageAnimation,
          options: ["Slide", "Stack"],
          onSelect: (val) => setPageAnimation(val as any),
        },
        {
          type: "toggle",
          icon: "eye-outline",
          key: "@keepAwake",
          label: "Keep Awake",
          subtitle: "Prevents screen dimming during calls",
        },
      ],
    },
    {
      title: "Security & Privacy",
      icon: "shield-checkmark-outline",
      color: "#10b981",
      items: [
        {
          type: "toggle",
          icon: "lock-closed-outline",
          key: "@biometricLock",
          label: "App Lock",
          subtitle: "Biometric authentication",
        },
        {
          type: "info",
          icon: "key-outline",
          label: "Encryption",
          value: "DTLS-SRTP P2P",
        },
      ],
    },
    {
      title: "Calls",
      icon: "call-outline",
      color: "#f97316",
      items: [
        {
          type: "action",
          icon: "albums-outline",
          label: "Incoming Call Popups",
          subtitle: "Allow floating and lock screen call alerts",
          onPress: handleOverlayPermission,
        },
        {
          type: "action",
          icon: "battery-charging-outline",
          label: "Battery Optimization",
          subtitle: "Keep calls working when app is closed",
          onPress: handleBatteryOptimization,
        },
        {
          type: "action",
          icon: "notifications-outline",
          label: "Notification Settings",
          subtitle: "Enable floating call notifications",
          onPress: () => Linking.openSettings(),
        },
      ],
    },
    {
      title: "System",
      icon: "cog-outline",
      color: "#64748b",
      items: [
        {
          type: "action",
          icon: "trash-outline",
          label: "Clear Local Cache",
          color: "#f43f5e",
          onPress: () => Alert.alert("Cache Cleared"),
        },
        {
          type: "action",
          icon: "log-out-outline",
          label: "Sign Out",
          color: "#f43f5e",
          onPress: handleLogout,
        },
      ],
    },
  ];

  const toggleValues: Record<
    string,
    { value: boolean; setter: (v: boolean) => void }
  > = {
    "@keepAwake": { value: keepAwake, setter: setKeepAwake },
    "@notifications": { value: notifications, setter: setNotifications },
    "@biometricLock": { value: biometricLock, setter: setBiometricLock },
    "@betaFeatures": { value: betaFeatures, setter: setBetaFeatures },
  };

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <ScrollView
          contentContainerStyle={styles.scrollBody}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.minimalHeader}>
            <TouchableOpacity
              onPress={() => setShowPicker(true)}
              activeOpacity={0.8}
              style={styles.minimalAvatarWrapper}
            >
              {profileImage ? (
                <Image
                  source={{ uri: profileImage }}
                  style={styles.minimalAvatar}
                  contentFit="cover"
                />
              ) : (
                <View style={styles.minimalAvatarPlaceholder}>
                  <Ionicons name="person" size={28} color="#94a3b8" />
                </View>
              )}
              <View style={styles.minimalCameraBadge}>
                <Ionicons name="camera" size={12} color="#fff" />
              </View>
            </TouchableOpacity>

            <View style={styles.minimalInfo}>
              {editingName ? (
                <View style={styles.minimalEditRow}>
                  <TextInput
                    style={styles.minimalNameInput}
                    value={nameInput}
                    onChangeText={setNameInput}
                    autoFocus
                    onBlur={handleSaveName}
                    onSubmitEditing={handleSaveName}
                  />
                  <TouchableOpacity onPress={handleSaveName}>
                    <Ionicons
                      name="checkmark-circle"
                      size={26}
                      color="#10b981"
                    />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.minimalNameRow}
                  onPress={() => {
                    setNameInput(name ?? "");
                    setEditingName(true);
                  }}
                >
                  <Text style={styles.minimalDisplayName}>
                    {name || "User"}
                  </Text>
                  <Ionicons
                    name="pencil"
                    size={14}
                    color="#38bdf8"
                    style={{ marginLeft: 6 }}
                  />
                </TouchableOpacity>
              )}
              <Text style={styles.minimalNodeId}>{shortId}</Text>
            </View>
          </View>

          {sections.map((section, sIdx) => (
            <Animated.View
              key={section.title}
              entering={FadeInUp.delay(sIdx * 80).duration(400)}
              style={styles.section}
            >
              <View style={styles.sectionTitleRow}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
              </View>

              <View style={styles.card}>
                {section.items.map((item, iIdx) => (
                  <View key={iIdx}>
                    {iIdx > 0 && <View style={styles.divider} />}

                    <View style={styles.itemRow}>
                      <View
                        style={[
                          styles.itemIconBg,
                          { backgroundColor: section.color + "10" },
                        ]}
                      >
                        <Ionicons
                          name={item.icon}
                          size={18}
                          color={section.color}
                        />
                      </View>

                      <View style={styles.itemMain}>
                        <Text style={styles.itemLabel}>{item.label}</Text>
                        {"subtitle" in item && item.subtitle && (
                          <Text style={styles.itemSub}>{item.subtitle}</Text>
                        )}
                      </View>

                      {item.type === "toggle" && (
                        <Switch
                          value={toggleValues[item.key]?.value ?? false}
                          onValueChange={(v) =>
                            toggle(item.key, v, toggleValues[item.key]?.setter)
                          }
                          trackColor={{ false: "#e2e8f0", true: "#38bdf8" }}
                          thumbColor="#fff"
                        />
                      )}

                      {item.type === "info" && (
                        <Text style={styles.itemValue}>{item.value}</Text>
                      )}

                      {item.type === "action" && (
                        <TouchableOpacity
                          onPress={item.onPress}
                          style={styles.actionChevron}
                        >
                          <Ionicons
                            name="chevron-forward"
                            size={18}
                            color="#cbd5e1"
                          />
                        </TouchableOpacity>
                      )}

                      {item.type === "select" && (
                        <View style={styles.selectGroup}>
                          {item.options.map((opt) => (
                            <TouchableOpacity
                              key={opt}
                              onPress={() => item.onSelect(opt)}
                              style={[
                                styles.selectBtn,
                                item.value === opt && {
                                  backgroundColor: "#38bdf8",
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.selectBtnText,
                                  item.value === opt && { color: "#fff" },
                                ]}
                              >
                                {opt}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            </Animated.View>
          ))}

          <View style={styles.footerBrandContainer}>
            <Text style={styles.footerBrand}>
              Srot v1.0 • Decentralized P2P
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>

      {/* Premium Photo Picker Modal */}
      <Modal
        transparent
        visible={showPicker}
        animationType="none"
        statusBarTranslucent={true}
        onRequestClose={() => setShowPicker(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setShowPicker(false)}
          >
            <Animated.View
              entering={FadeIn.duration(200)}
              style={styles.modalBackdrop}
            >
              <BlurView
                intensity={20}
                style={StyleSheet.absoluteFill}
                tint="dark"
              />
            </Animated.View>
          </Pressable>

          <Animated.View
            entering={SlideInDown.duration(300)}
            exiting={SlideOutDown.duration(250)}
            style={styles.pickerSheet}
          >
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Profile Photo</Text>
            <Text style={styles.sheetSub}>
              Choose a method to update your identity
            </Text>

            <View style={styles.pickerOptions}>
              <TouchableOpacity
                style={styles.pickerOption}
                onPress={pickFromCamera}
                activeOpacity={0.7}
              >
                <View
                  style={[styles.pickerIconBg, { backgroundColor: "#3b82f6" }]}
                >
                  <Ionicons name="camera" size={28} color="#fff" />
                </View>
                <Text style={styles.pickerText}>Take Photo</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.pickerOption}
                onPress={pickFromGallery}
                activeOpacity={0.7}
              >
                <View
                  style={[styles.pickerIconBg, { backgroundColor: "#10b981" }]}
                >
                  <Ionicons name="images" size={28} color="#fff" />
                </View>
                <Text style={styles.pickerText}>Gallery</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => setShowPicker(false)}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>

            {/* Extended background to cover navigation bar gap */}
            <View style={styles.bottomGapCover} />
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  safeArea: {
    flex: 1,
  },
  scrollBody: {
    paddingTop: 10,
    paddingBottom: 40,
    paddingHorizontal: 20,
  },
  minimalHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 20,
    marginBottom: 10,
  },
  minimalAvatarWrapper: {
    position: "relative",
  },
  minimalAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#f1f5f9",
  },
  minimalAvatarPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#f1f5f9",
    justifyContent: "center",
    alignItems: "center",
  },
  minimalCameraBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    backgroundColor: "#38bdf8",
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  minimalInfo: {
    marginLeft: 16,
    flex: 1,
  },
  minimalNameRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  minimalDisplayName: {
    fontSize: 22,
    fontWeight: "700",
    color: "#0f172a",
  },
  minimalNodeId: {
    fontSize: 12,
    color: "#64748b",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginTop: 2,
  },
  minimalEditRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  minimalNameInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    color: "#0f172a",
    padding: 0,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitleRow: {
    marginBottom: 8,
    marginLeft: 4,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#94a3b8",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#f1f5f9",
    overflow: "hidden",
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
  },
  divider: {
    height: 1,
    backgroundColor: "#f1f5f9",
    marginHorizontal: 14,
  },
  itemIconBg: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  itemMain: {
    flex: 1,
  },
  itemLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1e293b",
  },
  itemSub: {
    fontSize: 12,
    color: "#64748b",
    marginTop: 1,
  },
  itemValue: {
    fontSize: 13,
    fontWeight: "600",
    color: "#94a3b8",
  },
  actionChevron: {
    padding: 4,
  },
  selectGroup: {
    flexDirection: "row",
    backgroundColor: "#f1f5f9",
    borderRadius: 10,
    padding: 3,
  },
  selectBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 7,
  },
  selectBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748b",
  },
  footerBrandContainer: {
    marginTop: 20,
    marginBottom: 20,
    alignItems: "center",
  },
  footerBrand: {
    fontSize: 11,
    color: "#cbd5e1",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "transparent",
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  pickerSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: Platform.OS === "ios" ? 40 : 30, // Increased to cover Android nav bar
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 20,
    width: "100%",
  },
  sheetHandle: {
    width: 40,
    height: 5,
    backgroundColor: "#e2e8f0",
    borderRadius: 2.5,
    alignSelf: "center",
    marginBottom: 20,
  },
  sheetTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#0f172a",
    textAlign: "center",
  },
  sheetSub: {
    fontSize: 14,
    color: "#64748b",
    textAlign: "center",
    marginTop: 4,
    marginBottom: 30,
  },
  pickerOptions: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginBottom: 30,
  },
  pickerOption: {
    alignItems: "center",
    width: 120,
  },
  pickerIconBg: {
    width: 70,
    height: 70,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  pickerText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1e293b",
  },
  cancelBtn: {
    backgroundColor: "#f1f5f9",
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
  },
  cancelText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#64748b",
  },
  bottomGapCover: {
    height: 100,
    backgroundColor: "#fff",
    width: SCREEN_WIDTH,
    position: "absolute",
    bottom: -99,
    left: 0,
  },
});
