package com.revolut.revolut;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Bundle;
import android.service.notification.StatusBarNotification;
import android.util.Base64;
import android.util.Log;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * SMOKE-TEST ONLY fake notification poster (never install on a real phone).
 *
 * Built twice: applicationId com.revolut.revolut (allow-listed source) and
 * com.treasury.smokeposter.other (NG13 non-Revolut). Component class is always
 * com.revolut.revolut.Post.
 *
 * Extras: action = post|cancel|cancelAll|dump (default post), nonce (echoed),
 * t64/b64 = base64 UTF-8 title/body (absent => ""), id (int, required for
 * post/cancel), group (optional setGroup), summary (bool setGroupSummary).
 *
 * After acting, a worker thread polls this package's active notifications
 * (up to 4.5 s) until the requested state is visible, then logs ONE line:
 *   TSPoster: TSPOSTER {"nonce":..,"action":..,"ok":bool,"active":[...]}
 * Title/body in the log are base64 so logcat cannot mangle Unicode.
 */
public class Post extends Activity {
  private static final String TAG = "TSPoster";

  @Override protected void onCreate(Bundle b) {
    super.onCreate(b);
    handle(getIntent());
  }

  @Override protected void onNewIntent(android.content.Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    handle(intent);
  }

  private void handle(android.content.Intent intent) {
    final String action = intent.getStringExtra("action") == null ? "post" : intent.getStringExtra("action");
    final String nonce = intent.getStringExtra("nonce") == null ? "" : intent.getStringExtra("nonce");
    final int id = intent.getIntExtra("id", Integer.MIN_VALUE);
    final String title = dec(intent.getStringExtra("t64"));
    final String body = dec(intent.getStringExtra("b64"));
    final String group = intent.getStringExtra("group");
    final boolean summary = intent.getBooleanExtra("summary", false);
    final NotificationManager nm = getSystemService(NotificationManager.class);
    String err = null;
    try {
      if ("post".equals(action)) {
        if (id == Integer.MIN_VALUE) throw new IllegalArgumentException("id required");
        nm.createNotificationChannel(new NotificationChannel("tx", "tx", NotificationManager.IMPORTANCE_HIGH));
        Notification.Builder nb = new Notification.Builder(this, "tx")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title).setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body));
        if (group != null && !group.isEmpty()) nb.setGroup(group);
        nb.setGroupSummary(summary);
        nm.notify(id, nb.build());
      } else if ("cancel".equals(action)) {
        if (id == Integer.MIN_VALUE) throw new IllegalArgumentException("id required");
        nm.cancel(id);
      } else if ("cancelAll".equals(action)) {
        nm.cancelAll();
      } else if (!"dump".equals(action)) {
        throw new IllegalArgumentException("unknown action " + action);
      }
    } catch (Exception e) {
      err = e.toString();
    }
    final String error = err;
    new Thread(() -> {
      JSONObject out = new JSONObject();
      try {
        boolean ok = error == null;
        JSONArray active = new JSONArray();
        long deadline = System.currentTimeMillis() + 4500;
        while (ok) {
          active = snapshot(nm);
          if (satisfied(action, active, id, title, body, summary)) break;
          if (System.currentTimeMillis() > deadline) { ok = false; break; }
          Thread.sleep(100);
        }
        if (error != null) active = snapshot(nm);
        out.put("nonce", nonce).put("action", action).put("id", id)
           .put("ok", ok).put("error", error == null ? JSONObject.NULL : error)
           .put("pkg", getPackageName()).put("loggedAt", System.currentTimeMillis())
           .put("active", active);
      } catch (Exception e) {
        try { out.put("nonce", nonce).put("ok", false).put("error", e.toString()); } catch (Exception ignored) { }
      }
      Log.i(TAG, "TSPOSTER " + out);
      // Keep the translucent Activity alive so another am start reaches onNewIntent;
      // it leaves foreground when the Treasury Scribe Activity is explicitly launched.
    }).start();
  }

  private static JSONArray snapshot(NotificationManager nm) throws Exception {
    JSONArray arr = new JSONArray();
    for (StatusBarNotification s : nm.getActiveNotifications()) {
      Notification n = s.getNotification();
      Bundle x = n.extras;
      CharSequence t = x == null ? null : x.getCharSequence(Notification.EXTRA_TITLE);
      CharSequence bt = x == null ? null : x.getCharSequence(Notification.EXTRA_TEXT);
      JSONObject o = new JSONObject();
      o.put("id", s.getId()).put("tag", s.getTag() == null ? JSONObject.NULL : s.getTag())
       .put("key", s.getKey()).put("postTime", s.getPostTime()).put("flags", n.flags)
       .put("isSummary", (n.flags & Notification.FLAG_GROUP_SUMMARY) != 0)
       .put("group", n.getGroup() == null ? JSONObject.NULL : n.getGroup())
       .put("groupKey", s.getGroupKey())
       .put("t64", enc(t == null ? "" : t.toString())).put("b64", enc(bt == null ? "" : bt.toString()));
      arr.put(o);
    }
    return arr;
  }

  private static boolean satisfied(String action, JSONArray a, int id, String title, String body, boolean summary) throws Exception {
    boolean found = false;
    for (int i = 0; i < a.length(); i++) {
      JSONObject o = a.getJSONObject(i);
      if (!o.isNull("tag")) continue;
      if (o.getInt("id") != id) continue;
      if ("post".equals(action)) {
        found = o.getString("t64").equals(enc(title)) && o.getString("b64").equals(enc(body))
            && o.getBoolean("isSummary") == summary;
      } else {
        found = true;
      }
    }
    if ("post".equals(action)) return found;
    if ("cancel".equals(action)) return !found;
    if ("cancelAll".equals(action)) { for (int i = 0; i < a.length(); i++) if (a.getJSONObject(i).isNull("tag")) return false; return true; }
    return true; // dump
  }

  private String str(String k, String d) {
    String v = getIntent().getStringExtra(k);
    return v == null ? d : v;
  }

  private static String enc(String s) {
    return Base64.encodeToString(s.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
  }

  private static String dec(String s) {
    // `adb shell am start --es key ""` drops empty argument values; the runner
    // sends this non-empty sentinel to preserve subsequent extras.
    if (s == null || "~EMPTY~".equals(s)) return "";
    return new String(Base64.decode(s, Base64.DEFAULT), StandardCharsets.UTF_8);
  }
}
