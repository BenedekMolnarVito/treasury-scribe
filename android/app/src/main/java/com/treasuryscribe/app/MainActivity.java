package com.treasuryscribe.app;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NotificationListenerPlugin.class);
        super.onCreate(savedInstanceState);
        
        // Start the notification monitoring service on app launch.
        // This ensures it's running whenever the user opens the app,
        // and sidesteps Android 12+ ForegroundServiceStartNotAllowedException
        // that would occur if started from a broadcast receiver on fresh install.
        Intent serviceIntent = new Intent(this, RevolutNotificationService.class);
        startService(serviceIntent);
    }
}
