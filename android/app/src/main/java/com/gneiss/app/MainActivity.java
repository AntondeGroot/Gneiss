package com.gneiss.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registered before super, which is when the bridge builds its plugin
        // registry — afterwards is too late and the call fails at runtime.
        registerPlugin(VaultAccessPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
