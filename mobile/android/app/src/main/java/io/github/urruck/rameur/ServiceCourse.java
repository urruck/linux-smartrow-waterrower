package io.github.urruck.rameur;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.Locale;

/**
 * Sortie de course à pied : GPS du téléphone (LocationManager, sans Google
 * Play Services), consignes vocales des étapes et annonces de chaque
 * kilomètre. Tout se passe ici, en service au premier plan, pour continuer
 * écran éteint et téléphone dans la poche. La sortie est enregistrée dans
 * sessions/AAAA-MM-JJ_HHMMSS_course.json (même dossier que les séances de
 * rame), toutes les 30 secondes puis à l'arrêt.
 */
public class ServiceCourse extends Service implements LocationListener {
    private static final String TAG = "Course";
    private static final String CANAL = "course";
    private static final int NOTIF = 42;
    private static final float PRECISION_DEPART = 25f;   // m : précision attendue pour démarrer
    private static final float PRECISION_MAX = 30f;      // m : au-delà, le point est ignoré
    private static final float VITESSE_MAX = 12f;        // m/s : au-delà, saut de GPS

    static volatile ServiceCourse instance;

    private final Object verrou = new Object();
    private final Handler handler = new Handler(Looper.getMainLooper());

    // paramètres
    private String programme;
    private JSONArray etapes = new JSONArray();
    private boolean annonceKm = true;
    private boolean voix = true;
    private String intro = "";

    // état
    private boolean enregistrement = false;
    private boolean pause = false;
    private long cumulMs = 0, repriseMs = 0;
    private Date debut;
    private String fichier;
    private double distance = 0;
    private Location ancre;
    private long dernierFixMs = 0;
    private float precision = -1;
    private final ArrayList<double[]> trace = new ArrayList<>();
    private final ArrayList<Integer> kmTemps = new ArrayList<>();
    private int etape = -1;
    private double etapeT0 = 0, etapeD0 = 0;
    private boolean termine = false;
    private int dernierBip = -1;
    private boolean uneMinuteDite = false;
    private long derniereSauvegarde = 0, derniereNotif = 0;

    private TextToSpeech tts;
    private boolean ttsPret = false;
    private ToneGenerator bips;
    private PowerManager.WakeLock eveil;
    private AudioManager audio;
    private AudioFocusRequest focus;

    // --- Cycle de vie -------------------------------------------------------------

    @Override
    public void onCreate() {
        super.onCreate();
        audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        tts = new TextToSpeech(this, statut -> {
            if (statut == TextToSpeech.SUCCESS) {
                tts.setLanguage(Locale.FRANCE);
                tts.setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) { }
                    @Override public void onDone(String id) { if (!tts.isSpeaking()) rendreFocus(); }
                    @Override public void onError(String id) { rendreFocus(); }
                });
                ttsPret = true;
                if (!intro.isEmpty() && !enregistrement) parler(intro, true);
            }
        });
        try { bips = new ToneGenerator(AudioManager.STREAM_MUSIC, 90); } catch (RuntimeException e) { bips = null; }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        demarrerPremierPlan();
        if (instance == null) {
            instance = this;
            try {
                JSONObject p = new JSONObject(intent != null && intent.getStringExtra("parametres") != null
                        ? intent.getStringExtra("parametres") : "{}");
                programme = p.isNull("programme") ? null : p.optString("programme", null);
                etapes = p.optJSONArray("etapes") != null ? p.optJSONArray("etapes") : new JSONArray();
                annonceKm = p.optBoolean("annonceKm", true);
                voix = p.optBoolean("voix", true);
                intro = p.optString("intro", "Recherche du signal GPS.");
            } catch (JSONException e) {
                Log.w(TAG, "Paramètres illisibles", e);
            }
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            eveil = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "rameur:course");
            eveil.acquire(5 * 3600 * 1000L);
            try {
                LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 0, this, Looper.getMainLooper());
            } catch (SecurityException | IllegalArgumentException e) {
                Log.e(TAG, "GPS inaccessible", e);
            }
            if (ttsPret && !intro.isEmpty()) parler(intro, true);
            handler.post(tic);
        }
        return START_NOT_STICKY;
    }

    private void demarrerPremierPlan() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CANAL) == null) {
            NotificationChannel c = new NotificationChannel(CANAL, "Course à pied", NotificationManager.IMPORTANCE_LOW);
            c.setDescription("Sortie en cours : distance et temps");
            c.setShowBadge(false);
            nm.createNotificationChannel(c);
        }
        Notification n = notification("Recherche du GPS…");
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIF, n);
        }
    }

    private Notification notification(String texte) {
        Intent ouvrir = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, ouvrir,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CANAL)
                .setSmallIcon(R.drawable.ic_notif_course)
                .setContentTitle("Course à pied")
                .setContentText(texte)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setCategory(NotificationCompat.CATEGORY_WORKOUT)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .setContentIntent(pi)
                .build();
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(tic);
        try { ((LocationManager) getSystemService(Context.LOCATION_SERVICE)).removeUpdates(this); }
        catch (SecurityException e) { /* rien */ }
        if (eveil != null && eveil.isHeld()) eveil.release();
        if (tts != null) { tts.stop(); tts.shutdown(); }
        if (bips != null) bips.release();
        rendreFocus();
        if (instance == this) instance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    // --- GPS ----------------------------------------------------------------------

    @Override
    public void onLocationChanged(Location l) {
        synchronized (verrou) {
            dernierFixMs = SystemClock.elapsedRealtime();
            precision = l.hasAccuracy() ? l.getAccuracy() : 10f;
            if (!enregistrement) {
                if (precision > PRECISION_DEPART) return;
                commencer("Signal GPS trouvé. ");
            }
            if (pause || precision > PRECISION_MAX) return;
            double t = tempsActif();
            if (ancre == null) {
                ancre = l;
                ajouterPoint(l, t);
                return;
            }
            float d = ancre.distanceTo(l);
            double dt = (l.getElapsedRealtimeNanos() - ancre.getElapsedRealtimeNanos()) / 1e9;
            if (dt > 0 && d / dt > VITESSE_MAX) return;
            // on n'avance l'ancre qu'au-delà du bruit du GPS : pas de distance fantôme à l'arrêt
            if (d >= Math.max(5f, precision * 0.6f)) {
                distance += d;
                ancre = l;
                ajouterPoint(l, t);
                verifierKm(t);
            }
        }
    }

    @Override public void onProviderEnabled(String p) { }
    @Override public void onProviderDisabled(String p) { parler("Attention : le GPS est désactivé.", false); }
    @Override public void onStatusChanged(String p, int s, Bundle b) { }

    private void ajouterPoint(Location l, double t) {
        trace.add(new double[]{arr(t, 1), arr(l.getLatitude(), 6), arr(l.getLongitude(), 6),
                l.hasAltitude() ? arr(l.getAltitude(), 1) : 0, arr(distance, 1)});
    }

    private void verifierKm(double t) {
        while (distance >= (kmTemps.size() + 1) * 1000.0) {
            int precedent = kmTemps.isEmpty() ? 0 : kmTemps.get(kmTemps.size() - 1);
            kmTemps.add((int) t);
            int n = kmTemps.size();
            if (annonceKm) {
                parler(n + (n > 1 ? " kilomètres" : " kilomètre") + " en " + dureeParlee((int) t)
                        + ". Ce kilomètre : " + allureParlee((int) t - precedent) + ".", false);
            }
        }
    }

    // --- Chrono, étapes -----------------------------------------------------------

    private double tempsActif() {
        long ms = cumulMs;
        if (enregistrement && !pause) ms += SystemClock.elapsedRealtime() - repriseMs;
        return ms / 1000.0;
    }

    private void commencer(String prefixe) {
        enregistrement = true;
        repriseMs = SystemClock.elapsedRealtime();
        debut = new Date();
        fichier = new SimpleDateFormat("yyyy-MM-dd_HHmmss", Locale.ROOT).format(debut) + "_course.json";
        bip(ToneGenerator.TONE_PROP_ACK, 400);
        vibrer();
        if (etapes.length() > 0) {
            etape = 0;
            etapeT0 = 0;
            etapeD0 = 0;
            parler(prefixe + "C'est parti. " + etapes.optJSONObject(0).optString("texte", ""), true);
        } else {
            parler(prefixe + "C'est parti, bonne sortie !", true);
        }
    }

    private void etapeSuivante() {
        etape++;
        dernierBip = -1;
        uneMinuteDite = false;
        etapeT0 = tempsActif();
        etapeD0 = distance;
        vibrer();
        if (etape >= etapes.length()) {
            termine = true;
            bip(ToneGenerator.TONE_PROP_ACK, 600);
            parler("Séance terminée, bravo ! " + distanceParlee(distance) + " en " + dureeParlee((int) tempsActif())
                    + ". Arrêtez l'enregistrement quand vous voulez.", true);
        } else {
            bip(ToneGenerator.TONE_PROP_ACK, 400);
            parler(etapes.optJSONObject(etape).optString("texte", ""), true);
        }
    }

    private final Runnable tic = new Runnable() {
        @Override
        public void run() {
            synchronized (verrou) {
                long maintenant = SystemClock.elapsedRealtime();
                if (enregistrement && !pause && !termine && etape >= 0 && etape < etapes.length()) {
                    JSONObject e = etapes.optJSONObject(etape);
                    double duree = e.optDouble("duree_s", 0), dist = e.optDouble("distance_m", 0);
                    double reste;
                    if (duree > 0) {
                        reste = duree - (tempsActif() - etapeT0);
                        int s = (int) Math.ceil(reste);
                        if (s >= 1 && s <= 3 && s != dernierBip) { dernierBip = s; bip(ToneGenerator.TONE_PROP_BEEP, 150); }
                        if (duree >= 180 && reste <= 60 && !uneMinuteDite) {
                            uneMinuteDite = true;
                            parler("Encore une minute.", false);
                        }
                    } else {
                        reste = dist - (distance - etapeD0);
                    }
                    if (reste <= 0) etapeSuivante();
                }
                if (maintenant - derniereNotif > 5000) {
                    derniereNotif = maintenant;
                    NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                    nm.notify(NOTIF, notification(texteNotification()));
                }
                if (enregistrement && maintenant - derniereSauvegarde > 30000) {
                    derniereSauvegarde = maintenant;
                    ecrire(false);
                }
            }
            handler.postDelayed(this, 500);
        }
    };

    private String texteNotification() {
        if (!enregistrement) return "Recherche du GPS…";
        String t = String.format(Locale.FRANCE, "%.2f km · %s", distance / 1000, chrono((int) tempsActif()));
        if (distance > 100) t += " · " + allureCourte(tempsActif() / distance * 1000) + "/km";
        return pause ? "En pause · " + t : t;
    }

    // --- Commandes (appelées par CourseGpsPlugin) -----------------------------------

    void mettreEnPause() {
        synchronized (verrou) {
            if (!enregistrement || pause) return;
            cumulMs += SystemClock.elapsedRealtime() - repriseMs;
            pause = true;
            ancre = null;
            parler("Pause.", true);
        }
    }

    void reprendre() {
        synchronized (verrou) {
            if (!pause) return;
            repriseMs = SystemClock.elapsedRealtime();
            pause = false;
            parler("C'est reparti.", true);
        }
    }

    void forcerDepart() {
        synchronized (verrou) { if (!enregistrement) commencer(""); }
    }

    void passerEtape() {
        synchronized (verrou) {
            if (enregistrement && !termine && etape >= 0 && etape < etapes.length()) etapeSuivante();
        }
    }

    void voix(boolean v) { voix = v; if (!v && tts != null) tts.stop(); }

    /** Arrête la sortie ; renvoie le résumé (et le nom du fichier s'il est gardé). */
    JSONObject arreter(boolean garder) {
        JSONObject r;
        synchronized (verrou) {
            if (enregistrement && !pause) {
                cumulMs += SystemClock.elapsedRealtime() - repriseMs;
                pause = true;
            }
            boolean utile = enregistrement && (distance >= 50 || tempsActif() >= 60);
            r = etat();
            try {
                if (garder && utile) {
                    if (etapes.length() == 0) termine = true;
                    ecrire(true);
                    r.put("fichier", fichier);
                } else {
                    if (fichier != null) new File(new File(getFilesDir(), "sessions"), fichier).delete();
                    r.put("fichier", JSONObject.NULL);
                }
            } catch (JSONException e) { Log.w(TAG, "résumé", e); }
        }
        if (tts != null) tts.stop();
        stopForeground(true);
        stopSelf();
        instance = null;
        return r;
    }

    JSONObject etat() {
        synchronized (verrou) {
            JSONObject o = new JSONObject();
            try {
                double t = tempsActif();
                o.put("actif", true);
                o.put("enregistrement", enregistrement);
                o.put("pause", pause);
                o.put("programme", programme == null ? JSONObject.NULL : programme);
                o.put("temps_s", arr(t, 1));
                o.put("distance_m", arr(distance, 1));
                o.put("allure_km_s", distance > 50 ? arr(t / distance * 1000, 0) : JSONObject.NULL);
                o.put("allure_inst_km_s", allureInstantanee(t));
                o.put("precision_m", precision < 0 ? JSONObject.NULL : arr(precision, 0));
                o.put("gps_age_s", dernierFixMs == 0 ? JSONObject.NULL : (SystemClock.elapsedRealtime() - dernierFixMs) / 1000);
                o.put("etape", etape);
                o.put("nb_etapes", etapes.length());
                o.put("termine", termine);
                if (etape >= 0 && etape < etapes.length()) {
                    JSONObject e = etapes.optJSONObject(etape);
                    double duree = e.optDouble("duree_s", 0);
                    if (duree > 0) {
                        o.put("etape_reste", arr(Math.max(0, duree - (t - etapeT0)), 1));
                        o.put("etape_unite", "s");
                        o.put("etape_fait", Math.min(1, (t - etapeT0) / duree));
                    } else {
                        double dist = e.optDouble("distance_m", 1);
                        o.put("etape_reste", arr(Math.max(0, dist - (distance - etapeD0)), 0));
                        o.put("etape_unite", "m");
                        o.put("etape_fait", Math.min(1, (distance - etapeD0) / dist));
                    }
                }
                o.put("km", new JSONArray(kmTemps));
                o.put("nb_points", trace.size());
                o.put("debut", debut == null ? JSONObject.NULL : iso(debut));
            } catch (JSONException e) { Log.w(TAG, "état", e); }
            return o;
        }
    }

    JSONArray trace(int depuis) {
        synchronized (verrou) {
            JSONArray a = new JSONArray();
            for (int i = Math.max(0, depuis); i < trace.size(); i++) a.put(point(trace.get(i)));
            return a;
        }
    }

    private Object allureInstantanee(double t) {
        // allure des 30 dernières secondes
        for (int i = trace.size() - 1; i >= 0; i--) {
            double[] p = trace.get(i);
            if (t - p[0] >= 30) {
                double d = distance - p[4];
                return d > 20 ? arr((t - p[0]) / d * 1000, 0) : JSONObject.NULL;
            }
        }
        return JSONObject.NULL;
    }

    // --- Enregistrement -------------------------------------------------------------

    private void ecrire(boolean fin) {
        if (fichier == null) return;
        try {
            double t = tempsActif();
            JSONObject resume = new JSONObject();
            resume.put("distance_m", arr(distance, 1));
            resume.put("temps_s", (int) Math.round(t));
            resume.put("allure_km_s", distance > 50 ? arr(t / distance * 1000, 0) : JSONObject.NULL);
            resume.put("duree_totale_s", (int) ((new Date().getTime() - debut.getTime()) / 1000));
            JSONArray tr = new JSONArray();
            for (double[] p : trace) tr.put(point(p));
            JSONObject s = new JSONObject();
            s.put("debut", iso(debut));
            s.put("type", "course");
            s.put("programme", programme == null ? JSONObject.NULL : programme);
            s.put("termine", termine);
            if (!fin) s.put("en_cours", true);
            s.put("resume", resume);
            s.put("km", new JSONArray(kmTemps));
            s.put("trace", tr);
            s.put("points", new JSONArray());
            s.put("coups", new JSONArray());
            File dossier = new File(getFilesDir(), "sessions");
            dossier.mkdirs();
            File tmp = new File(dossier, fichier + ".tmp");
            try (FileOutputStream f = new FileOutputStream(tmp)) {
                f.write(s.toString().getBytes(StandardCharsets.UTF_8));
                f.getFD().sync();
            }
            if (!tmp.renameTo(new File(dossier, fichier))) Log.w(TAG, "renommage impossible : " + fichier);
        } catch (Exception e) {
            Log.e(TAG, "Enregistrement impossible", e);
        }
    }

    // --- Voix, sons -----------------------------------------------------------------

    private void parler(String texte, boolean interrompre) {
        if (!voix || !ttsPret || texte == null || texte.trim().isEmpty()) return;
        prendreFocus();
        tts.speak(texte, interrompre ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD, null,
                "c" + SystemClock.elapsedRealtime());
    }

    private void prendreFocus() {
        if (audio == null || Build.VERSION.SDK_INT < 26) return;
        if (focus == null) {
            focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                    .setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                    .build();
        }
        audio.requestAudioFocus(focus);   // la musique baisse pendant la consigne
    }

    private void rendreFocus() {
        if (audio != null && focus != null && Build.VERSION.SDK_INT >= 26) audio.abandonAudioFocusRequest(focus);
    }

    private void bip(int ton, int ms) {
        if (voix && bips != null) bips.startTone(ton, ms);
    }

    private void vibrer() {
        Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        if (v == null || !v.hasVibrator()) return;
        if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createWaveform(new long[]{0, 250, 150, 250}, -1));
        else v.vibrate(new long[]{0, 250, 150, 250}, -1);
    }

    // --- Mise en forme --------------------------------------------------------------

    private static double arr(double x, int n) {
        double f = Math.pow(10, n);
        return Math.round(x * f) / f;
    }

    private static JSONArray point(double[] p) {
        JSONArray a = new JSONArray();
        for (double v : p) {
            try { a.put(v); } catch (JSONException e) { /* nombre invalide */ }
        }
        return a;
    }

    private static String iso(Date d) {
        return new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.ROOT).format(d);
    }

    private static String chrono(int s) {
        return s >= 3600 ? String.format(Locale.ROOT, "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60)
                : String.format(Locale.ROOT, "%d:%02d", s / 60, s % 60);
    }

    private static String allureCourte(double s) {
        int x = (int) Math.round(s);
        return String.format(Locale.ROOT, "%d'%02d", x / 60, x % 60);
    }

    private static String dureeParlee(int s) {
        int h = s / 3600, m = s / 60 % 60, sec = s % 60;
        StringBuilder b = new StringBuilder();
        if (h > 0) b.append(h).append(h > 1 ? " heures " : " heure ");
        if (m > 0 || h > 0) b.append(m).append(m > 1 ? " minutes" : " minute");
        if (h == 0 && sec > 0) b.append(m > 0 ? " " : "").append(sec).append(sec > 1 ? " secondes" : " seconde");
        return b.toString().trim();
    }

    private static String allureParlee(int s) {
        return (s / 60) + " minutes " + (s % 60 > 0 ? String.valueOf(s % 60) : "") + " au kilomètre";
    }

    private static String distanceParlee(double m) {
        if (m < 1000) return Math.round(m) + " mètres";
        return String.format(Locale.FRANCE, "%.2f", m / 1000).replaceAll("0+$", "").replaceAll(",$", "") + " kilomètres";
    }
}
