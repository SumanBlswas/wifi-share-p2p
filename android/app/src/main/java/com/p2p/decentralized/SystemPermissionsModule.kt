package com.p2p.decentralized

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class SystemPermissionsModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "SystemPermissions"

  @ReactMethod
  fun canDrawOverlays(promise: Promise) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      promise.resolve(Settings.canDrawOverlays(reactContext))
    } else {
      promise.resolve(true)
    }
  }

  @ReactMethod
  fun openOverlaySettings() {
    val activity = reactContext.currentActivity ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      val intent = Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:" + activity.packageName)
      )
      activity.startActivity(intent)
    }
  }

  @ReactMethod
  fun isIgnoringBatteryOptimizations(promise: Promise) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      val pm = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
      promise.resolve(pm.isIgnoringBatteryOptimizations(reactContext.packageName))
    } else {
      promise.resolve(true)
    }
  }

  @ReactMethod
  fun requestIgnoreBatteryOptimizations() {
    val activity = reactContext.currentActivity ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      val intent = Intent(
        Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
        Uri.parse("package:" + activity.packageName)
      )
      activity.startActivity(intent)
    }
  }

  @ReactMethod
  fun openBatteryOptimizationSettings() {
    val activity = reactContext.currentActivity ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
      activity.startActivity(intent)
    }
  }
}
