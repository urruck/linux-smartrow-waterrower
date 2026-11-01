#!/usr/bin/env python3
"""Application de bureau du rameur : une fenêtre GTK 4 + WebKit qui affiche
la page de rameur.py, lancé en arrière-plan.

  python3 rameur_app.py              fenêtre de l'application
  python3 rameur_app.py --reseau     page aussi visible depuis une tablette
  python3 rameur_app.py --navigateur sans fenêtre : ouvre le navigateur

À la fermeture de la fenêtre, le serveur reçoit SIGTERM : la séance en cours
est enregistrée avant de quitter.
"""
import os
import signal
import socket
import subprocess
import sys
import time
import webbrowser

ICI = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("RAMEUR_PORT", "8765"))
ID_APPLI = "io.github.urruck.Rameur"


def port_ouvert(port):
    with socket.socket() as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) == 0


def demarrer_serveur():
    """Lance rameur.py, sauf s'il tourne déjà (lancé depuis un terminal)."""
    if port_ouvert(PORT):
        print(f"Serveur du rameur déjà lancé sur le port {PORT} : on s'y connecte.")
        return None
    options = ["--reseau"] if "--reseau" in sys.argv else []
    proc = subprocess.Popen([sys.executable, os.path.join(ICI, "rameur.py"), "--port", str(PORT)] + options)
    for _ in range(100):  # 10 s au plus
        if port_ouvert(PORT):
            return proc
        if proc.poll() is not None:
            raise SystemExit("Le serveur du rameur n'a pas pu démarrer (voir les messages ci-dessus).")
        time.sleep(0.1)
    proc.terminate()
    raise SystemExit("Le serveur du rameur ne répond pas.")


def arreter_serveur(proc):
    if proc and proc.poll() is None:
        proc.send_signal(signal.SIGTERM)  # rameur.py enregistre la séance
        try:
            proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            proc.kill()


def fenetre(url):
    import gi
    gi.require_version("Gtk", "4.0")
    gi.require_version("WebKit", "6.0")
    from gi.repository import Gtk, WebKit

    app = Gtk.Application(application_id=ID_APPLI)

    def activer(app):
        fenetres = app.get_windows()
        if fenetres:  # deuxième lancement : remettre la fenêtre au premier plan
            fenetres[0].present()
            return
        win = Gtk.ApplicationWindow(application=app, title="Rameur")
        win.set_default_size(1280, 860)
        win.set_icon_name("rameur-smartrow")
        vue = WebKit.WebView()
        r = vue.get_settings()
        r.set_media_playback_requires_user_gesture(False)  # bips et métronome
        r.set_enable_developer_extras(True)
        vue.load_uri(url)
        win.set_child(vue)
        win.maximize()
        win.present()

    app.connect("activate", activer)
    app.run([])


def main():
    proc = demarrer_serveur()
    url = f"http://127.0.0.1:{PORT}/"
    try:
        if "--navigateur" in sys.argv:
            raise ImportError("navigateur demandé")
        fenetre(url)
    except (ImportError, ValueError) as e:
        print(f"Fenêtre indisponible ({e}) : ouverture dans le navigateur, {url}")
        webbrowser.open(url)
        try:
            while proc is None or proc.poll() is None:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
    finally:
        arreter_serveur(proc)


if __name__ == "__main__":
    main()
