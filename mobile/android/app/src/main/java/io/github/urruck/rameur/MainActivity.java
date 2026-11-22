package io.github.urruck.rameur;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CourseGpsPlugin.class);   // course à pied (GPS), propre à l'application
        super.onCreate(savedInstanceState);
    }
}
