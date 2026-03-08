# WhatsApp Permission Architecture Analysis and Implementation Mapping

This document provides a best-effort mapping of WhatsApp-style permissions and a concrete implementation plan aligned with Android and Google Play policies. Screenshots and exact WhatsApp dialog copy must be captured manually on device because they cannot be generated programmatically here.

## 1. Permission Request Timing Analysis

### Observed permission groups from user device screenshots (HyperOS)
- Call logs
- Camera
- Contacts
- Location
- Microphone
- Music and audio
- Notifications
- Phone
- Photos and videos
- SMS
- Nearby devices (not allowed in the screenshots)

### Recommended timing and user journey mapping
- Onboarding
  - Notifications: request after explaining background call alerts.
  - Phone/SMS: request during account verification only.
- First call attempt
  - Microphone: request before call connect.
  - Camera: request only when video call or camera toggle is used.
  - Phone/Call logs: request only if integrating with system call logs or SIM call management.
- First chat open
  - Contacts: request when user taps “Sync contacts”.
  - Photos and videos: request when user attaches media.
  - Music and audio: request when sending audio files.
- Optional features
  - Location: request when user taps “Share location”.
  - Nearby devices: request when using nearby share feature.

### Permission priming strategy
- Use in-app explanatory sheet before triggering the system permission dialog.
- Show a single-screen explanation of why it’s required, what happens if denied, and a “Continue” button that launches the system prompt.
- Use feature-triggered prompts, not first-launch bundles, to improve acceptance rates.

## 2. Permission Dialog Design Patterns

### Required screenshots
- System permission dialogs for Camera, Microphone, Contacts, Location, Phone, SMS, Notifications, Storage.
- Any in-app permission rationale screens used by WhatsApp.

### Notes
- Exact WhatsApp copy and layout must be captured on-device.
- Use a consistent rationale template:
  - Title: “Allow access to X”
  - Body: “We need X to Y”
  - Buttons: “Not now” and “Continue”

## 3. Call Notification System Implementation

### Implemented
- System call UI through CallKeep for incoming calls.
- High-priority notification channels for incoming calls.
- Background push handling for closed-app calls via FCM data messages.

### Floating popup guidance
- Android overlays are restricted; use system heads-up full-screen call notifications and CallKeep.
- Provide settings shortcuts for enabling floating notifications and lock screen alerts.

## 4. Battery Optimization Bypass

### Implemented
- In-app request flow to disable battery optimizations for the app.
- Settings actions to open overlay and battery optimization controls on Android.

### OEM fallback guidance
- Xiaomi: enable “Open new windows while running in the background”, “Show on Lock screen”, “Floating notifications”.
- Samsung/OnePlus/Oppo: disable battery optimization and allow auto-start.

## 5. System-Level Integration Requirements

### Implemented
- Full-screen call UI via CallKeep and high-priority call notifications.
- Wake locks and foreground service permissions already present in manifest.
- Background call UI triggered on data push.

## 6. Technical Implementation Specifications

### Implemented
- Runtime permission prompts are feature-triggered in UI flows.
- Dedicated Android notification channel for incoming calls.
- Battery optimization and overlay permission shortcuts.

### Not implemented due to Play policy constraints
- NotificationListenerService for call detection is not required for call delivery and adds sensitive permissions.

## 7. Testing Requirements

### Required manual validation
- Android 6, 8, 10, 12, 13 permission flows.
- OEM testing: Samsung, Xiaomi, OnePlus, Oppo, Vivo, Redmi, Realme, Pixel, Motorola, Huawei.
- Measure time-to-answer from incoming call notification vs opening app.

## 8. Documentation Deliverables

- Permission mapping: This document.
- Technical implementation: See call services and settings actions in codebase.
- User flow diagrams: To be added after on-device capture.
- Battery optimization success metrics: To be recorded during QA.
- Call popup performance benchmarks: To be measured during QA.
