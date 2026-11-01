import WebSocket from 'ws';
import fetch from 'node-fetch';
import http from 'http';

// ================= 已全部填好 =================
const APP_ID = '1906212850'; 
const APP_SECRET = 'CLHF4nOrJlEcvspb'; 
const DEEPSEEK_KEY = 'sk'; 
// ==============================================

const API_BASE = 'https://api.sgroup.qq.com';

async function getToken() {
    const res = await fetch('https://bots.qq.com/app/getAppAccessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: APP_ID, clientSecret: APP_SECRET })
    });
    const data = await res.json();
    return data.access_token;
}

async function startBot() {
    const token = await getToken();
    if (!token) {
        console.log('❌ 获取 Token 失败，请检查 APP_ID 和 APP_SECRET');
        return;
    }

    const gatewayRes = await fetch(`${API_BASE}/gateway/bot`, {
        headers: { 'Authorization': `QQBot ${token}` }
    });
    const gatewayData = await gatewayRes.json();
    const wsUrl = gatewayData.url;
    
    if (!wsUrl) {
        console.log('❌ 获取 WebSocket 地址失败，可能是腾讯服务器拒绝，稍后重试');
        setTimeout(startBot, 10000);
        return;
    }

    console.log('🔗 正在连接 QQ 服务器...', wsUrl);
    const ws = new WebSocket(wsUrl);

    ws.on('open', () => console.log('✅ 已连接 QQ 服务器！机器人准备就绪！'));
    ws.on('close', () => {
        console.log('❌ 连接断开，5秒后重连...');
        setTimeout(startBot, 5000);
    });

    ws.on('message', async (data) => {
        const payload = JSON.parse(data.toString());

        // 鉴权与心跳
        if (payload.op === 10) {
            ws.send(JSON.stringify({
                op: 2,
                d: { token: `QQBot ${token}`, intents: (1 << 25) | (1 << 30) }
            }));
            setInterval(() => {
                ws.send(JSON.stringify({ op: 1, d: Date.now() }));
            }, payload.d.heartbeat_interval || 30000);
        }

        // 收到消息
        if (payload.op === 0 && (payload.t === 'AT_MESSAGE_CREATE' || payload.t === 'MESSAGE_CREATE')) {
            const d = payload.d;
            const userMsg = d.content.replace(/<@!\d+>/g, '').trim();
            const channelId = d.channel_id;
            const msgId = d.id;

            if (!userMsg) return;
            console.log('收到消息:', userMsg);

            try {
                const aiRes = await fetch('https://api.deepseek.com/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${DEEPSEEK_KEY}`
                    },
                    body: JSON.stringify({
                        model: 'deepseek-chat',
                        messages: [{ role: 'user', content: userMsg }]
                    })
                });
                const aiData = await aiRes.json();
                
                if (aiData.choices && aiData.choices.length > 0) {
                    const reply = aiData.choices[0].message.content;
                    await fetch(`${API_BASE}/channels/${channelId}/messages`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `QQBot ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ content: reply, msg_id: msgId })
                    });
                    console.log('✅ 已回复');
                } else {
                    console.log('⚠️ DeepSeek 未返回内容，请检查 API Key 是否有余额');
                }
            } catch (error) {
                console.error('❌ AI 报错:', error.message);
            }
        }
    });
}

// 启动机器人
startBot();

// 伪装成 Web 服务器，防止云端平台找不到端口报错
const port = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('QQ Bot is running!\n');
}).listen(port, () => {
  console.log(`Web server listening on port ${port}`);
});
