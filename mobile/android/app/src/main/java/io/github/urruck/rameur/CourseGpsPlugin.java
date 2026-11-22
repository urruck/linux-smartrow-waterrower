package io.github.urruck.rameur;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONException;
import org.json.JSONObject;

/** Pont entre la page (serveur.js) et ServiceCourse. */
@CapacitorPlugin(
        name = "CourseGps",
        permissions = {
                @Permission(alias = "localisation",
                        strings = {Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}),
                @Permission(alias = "notifications", strings = {"android.permission.POST_NOTIFICATIONS"})
        })
public class CourseGpsPlugin extends Plugin {

    private boolean localisationPrecise() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    private boolean gpsActive() {
        LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        return lm != null && lm.isProviderEnabled(LocationManager.GPS_PROVIDER);
    }

    /** Démarre une sortie : { programme, etapes: [{duree_s | distance_m, texte}], annonceKm, voix, intro }. */
    @PluginMethod
    public void demarrer(PluginCall call) {
        if (ServiceCourse.instance != null) { call.resolve(etatJs()); return; }
        if (!localisationPrecise()) {
            requestPermissionForAlias("localisation", call, "apresLocalisation");
            return;
        }
        suite(call);
    }

    @PermissionCallback
    private void apresLocalisation(PluginCall call) {
        if (!localisationPrecise()) {
            call.reject("Localisation précise refusée : autorisez « Position exacte » pour suivre la course.", "REFUS");
            return;
        }
        suite(call);
    }

    private void suite(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED
                && !call.getBoolean("_notif", false)) {
            call.getData().put("_notif", true);
            requestPermissionForAlias("notifications", call, "apresNotifications");
            return;
        }
        lancer(call);
    }

    @PermissionCallback
    private void apresNotifications(PluginCall call) { lancer(call); }   // facultatif : la course marche sans

    private void lancer(PluginCall call) {
        if (!gpsActive()) {
            call.reject("La localisation (GPS) du téléphone est désactivée.", "GPS_OFF");
            return;
        }
        Intent i = new Intent(getContext(), ServiceCourse.class);
        i.putExtra("parametres", call.getData().toString());
        ContextCompat.startForegroundService(getContext(), i);
        call.resolve();
    }

    @PluginMethod
    public void etat(PluginCall call) { call.resolve(etatJs()); }

    private JSObject etatJs() {
        ServiceCourse s = ServiceCourse.instance;
        JSObject r;
        try {
            r = s == null ? new JSObject() : JSObject.fromJSONObject(s.etat());
        } catch (JSONException e) {
            r = new JSObject();
        }
        if (s == null) r.put("actif", false);
        r.put("gps_active", gpsActive());
        r.put("autorise", localisationPrecise());
        return r;
    }

    @PluginMethod
    public void trace(PluginCall call) {
        ServiceCourse s = ServiceCourse.instance;
        JSObject r = new JSObject();
        try {
            r.put("points", s == null ? new JSArray() : new JSArray(s.trace(call.getInt("depuis", 0)).toString()));
        } catch (JSONException e) {
            r.put("points", new JSArray());
        }
        call.resolve(r);
    }

    @PluginMethod
    public void pause(PluginCall call) { ServiceCourse s = ServiceCourse.instance; if (s != null) s.mettreEnPause(); call.resolve(etatJs()); }

    @PluginMethod
    public void reprendre(PluginCall call) { ServiceCourse s = ServiceCourse.instance; if (s != null) s.reprendre(); call.resolve(etatJs()); }

    @PluginMethod
    public void forcer(PluginCall call) { ServiceCourse s = ServiceCourse.instance; if (s != null) s.forcerDepart(); call.resolve(etatJs()); }

    @PluginMethod
    public void suivante(PluginCall call) { ServiceCourse s = ServiceCourse.instance; if (s != null) s.passerEtape(); call.resolve(etatJs()); }

    @PluginMethod
    public void voix(PluginCall call) {
        ServiceCourse s = ServiceCourse.instance;
        if (s != null) s.voix(call.getBoolean("active", true));
        call.resolve();
    }

    @PluginMethod
    public void arreter(PluginCall call) {
        ServiceCourse s = ServiceCourse.instance;
        if (s == null) { call.resolve(etatJs()); return; }
        JSONObject r = s.arreter(call.getBoolean("garder", true));
        try {
            call.resolve(JSObject.fromJSONObject(r));
        } catch (JSONException e) {
            call.resolve();
        }
    }

    @PluginMethod
    public void reglagesGps(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }
}
