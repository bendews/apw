(function apwBridge() {
  const { port, token } = self.APW_CONFIG;
  const OK = 0, INVALID_SESSION = 9, SERVER_ERROR = 100;
  let ws, pending;
  const send = (message) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(message));
  const fail = (id, status, error) => send({ id, status, error: String(error) });

  function request(message) {
    if (message.cmd === 2) {
      message.pin == null ? ChallengePIN() : PINSet(message.pin);
      return send({ id: message.id, status: OK });
    }
    if (g_theState !== "SessionKeySet") return fail(message.id, INVALID_SESSION, "unpaired");
    pending = { id: message.id, cmd: message.cmd };
    try {
      const SMSG = g_secretSession.createSMSG(JSON.stringify(message.body));
      g_nativeAppPort.postMessage({
        cmd: message.cmd,
        tabId: message.tabId,
        frameId: message.frameId,
        url: message.url,
        payload: JSON.stringify({ QID: message.qid, SMSG }),
      });
    } catch (error) {
      pending = null;
      fail(message.id, SERVER_ERROR, error);
    }
  }

  function reply(message) {
    if (!pending || message.cmd !== pending.cmd && !(pending.cmd === 6 && message.cmd === 4)) return;
    const { id } = pending;
    pending = null;
    try {
      const data = message.payload
        ? JSON.parse(g_secretSession.parseSMSG(message.payload.SMSG))
        : { STATUS: message.STATUS ?? OK };
      send({ id, data });
    } catch (error) {
      fail(id, SERVER_ERROR, error);
    }
  }

  function connect() {
    ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.onopen = () => send({ token });
    ws.onerror = () => ws.close();
    ws.onclose = () => {
      pending = null;
      setTimeout(connect, 3000);
    };
    ws.onmessage = ({ data }) => request(JSON.parse(data));
  }
  if (!g_nativeAppPort) connectToBackgroundNativeAppAndSetUpListeners();
  g_nativeAppPort?.onMessage?.addListener(reply);
  connect();
})();
