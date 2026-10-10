package com.alberto.carrito;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.os.SystemClock;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;

/**
 * Dictado por voz con el SpeechRecognizer del sistema (en JS: registerPlugin('Voice'), ver src/voice.js).
 *
 * Se usa un único reconocedor para todas las escuchas. Destruirlo y crear otro en cada escucha (lo que hace
 * @capacitor-community/speech-recognition) hace que en Android 12+ todas menos la primera fallen al instante,
 * porque el sistema aún está desconectando el servicio del anterior («Service is unbinding»).
 *
 * listen() resuelve con { matches: [...] } (la más probable primero) o se rechaza con código
 * "permission", "nomatch", "network" o "failed". Mientras escucha emite los eventos "partial" { text }
 * (lo entendido hasta ahora) y "level" { level } (volumen en dB, unas 12 veces por segundo).
 */
@CapacitorPlugin(name = "Voice", permissions = { @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone") })
public class VoicePlugin extends Plugin {

    private static final long LEVEL_INTERVAL_MS = 80;

    private SpeechRecognizer recognizer;
    private PluginCall pending; // escucha en curso; solo se toca desde el hilo principal
    private long lastLevelAt;

    @PluginMethod
    public void available(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", SpeechRecognizer.isRecognitionAvailable(getContext()));
        call.resolve(ret);
    }

    @PluginMethod
    public void listen(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) start(call);
        else requestPermissionForAlias("microphone", call, "onMicrophonePermission");
    }

    @PermissionCallback
    private void onMicrophonePermission(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) start(call);
        else call.reject("Sin permiso de micrófono", "permission");
    }

    // Termina la escucha ya; lo dicho hasta ahora se reconoce y llega como resultado de listen()
    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (recognizer != null && pending != null) recognizer.stopListening();
            call.resolve();
        });
    }

    private void start(PluginCall call) {
        String language = call.getString("language", "es-ES");
        getActivity().runOnUiThread(() -> {
            if (pending != null) {
                call.reject("Ya está escuchando", "failed");
                return;
            }
            if (recognizer == null) {
                recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
                recognizer.setRecognitionListener(listener);
            }
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());
            pending = call;
            recognizer.startListening(intent);
        });
    }

    // Saca la escucha en curso; los avisos que lleguen después (algunos reconocedores mandan un error
    // tras el resultado) se ignoran
    private PluginCall takePending() {
        PluginCall call = pending;
        pending = null;
        return call;
    }

    private final RecognitionListener listener = new RecognitionListener() {
        @Override
        public void onResults(Bundle results) {
            PluginCall call = takePending();
            if (call == null) return;
            ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            JSObject ret = new JSObject();
            ret.put("matches", matches == null ? new JSArray() : new JSArray(matches));
            call.resolve(ret);
        }

        @Override
        public void onError(int error) {
            // Si el servicio se ha desconectado, el reconocedor ya no sirve: se crea otro en la próxima escucha
            if (error == SpeechRecognizer.ERROR_SERVER_DISCONNECTED && recognizer != null) {
                recognizer.destroy();
                recognizer = null;
            }
            PluginCall call = takePending();
            if (call == null) return;
            String code;
            switch (error) {
                case SpeechRecognizer.ERROR_NO_MATCH:
                case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                    code = "nomatch";
                    break;
                case SpeechRecognizer.ERROR_NETWORK:
                case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                case SpeechRecognizer.ERROR_SERVER:
                    code = "network";
                    break;
                case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                    code = "permission";
                    break;
                default:
                    code = "failed";
            }
            call.reject("Error de reconocimiento " + error, code);
        }

        @Override
        public void onReadyForSpeech(Bundle params) {}

        @Override
        public void onBeginningOfSpeech() {}

        // Volumen para animar la interfaz; se limita la frecuencia para no saturar el puente con JS
        @Override
        public void onRmsChanged(float rmsdB) {
            long now = SystemClock.uptimeMillis();
            if (pending == null || now - lastLevelAt < LEVEL_INTERVAL_MS) return;
            lastLevelAt = now;
            JSObject ret = new JSObject();
            ret.put("level", rmsdB);
            notifyListeners("level", ret);
        }

        @Override
        public void onBufferReceived(byte[] buffer) {}

        @Override
        public void onEndOfSpeech() {}

        @Override
        public void onPartialResults(Bundle partialResults) {
            if (pending == null) return;
            ArrayList<String> partial = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            if (partial == null || partial.isEmpty() || partial.get(0).trim().isEmpty()) return;
            JSObject ret = new JSObject();
            ret.put("text", partial.get(0));
            notifyListeners("partial", ret);
        }

        @Override
        public void onEvent(int eventType, Bundle params) {}
    };

    @Override
    protected void handleOnDestroy() {
        if (recognizer != null) {
            recognizer.destroy();
            recognizer = null;
        }
        PluginCall call = takePending();
        if (call != null) call.reject("La app se ha cerrado", "failed");
    }
}
