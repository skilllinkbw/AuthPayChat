# ── PayChat release rules ────────────────────────────────────────────────────
# Capacitor: the WebView bridge, plugin registry and native->JS entry points are
# reached reflectively / by name at runtime, so they must survive obfuscation.
-keep class com.getcapacitor.** { *; }
-keepclassmembers class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod <methods>;
}
-keep class * extends com.getcapacitor.Plugin { *; }
# Cordova compatibility layer (capacitor-cordova-android-plugins).
-keep class org.apache.cordova.** { *; }
# JS bridge annotation used by native -> WebView calls.
-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }
# Keep line numbers in release stack traces for crash triage without exposing sources.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile
