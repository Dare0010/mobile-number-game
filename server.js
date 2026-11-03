const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname)));

const room = {
    players: {}, // socketId -> { playerNo: 1|2, secret: '', locked: false }
    currentTurn: 1,
    pendingGuess: null
};

io.on('connection', (socket) => {
    const playerCount = Object.keys(room.players).length;

    if (playerCount >= 2) {
        socket.emit('room-full', '当前房间已有两人对战，请稍后再试！');
        socket.disconnect();
        return;
    }

    const assignedPlayerNo = playerCount === 0 ? 1 : (room.players[Object.keys(room.players)[0]].playerNo === 1 ? 2 : 1);
    room.players[socket.id] = { playerNo: assignedPlayerNo, secret: '', locked: false };

    socket.emit('init-player', { playerNo: assignedPlayerNo });
    io.emit('player-status', { count: Object.keys(room.players).length });

    // 锁定秘密数字
    socket.on('lock-secret', (secret) => {
        if (!room.players[socket.id]) return;
        room.players[socket.id].secret = secret;
        room.players[socket.id].locked = true;

        const allLocked = Object.values(room.players).length === 2 && 
                          Object.values(room.players).every(p => p.locked);

        if (allLocked) {
            io.emit('game-start', { currentTurn: room.currentTurn });
        } else {
            socket.emit('wait-for-other-lock');
            socket.broadcast.emit('other-player-locked');
        }
    });

    // 发起猜测
    socket.on('send-guess', (guessNum) => {
        const playerNo = room.players[socket.id].playerNo;
        if (playerNo !== room.currentTurn) return;

        const targetPlayerNo = playerNo === 1 ? 2 : 1;
        room.pendingGuess = guessNum;

        io.emit('guess-made', {
            guesser: playerNo,
            target: targetPlayerNo,
            guessNum: guessNum
        });
    });

    // 提交反馈
    socket.on('send-reply', (correctCount) => {
        const playerNo = room.players[socket.id].playerNo;
        const guesserNo = playerNo === 1 ? 2 : 1;
        const count = parseInt(correctCount);

        io.emit('reply-received', {
            guesser: guesserNo,
            responder: playerNo,
            guessNum: room.pendingGuess,
            count: count
        });

        if (count === 4) {
            const secrets = {};
            Object.values(room.players).forEach(p => secrets[p.playerNo] = p.secret);
            io.emit('game-over', { winner: guesserNo, secrets: secrets });
            return;
        }

        room.currentTurn = guesserNo;
        room.pendingGuess = null;
        io.emit('turn-change', { currentTurn: room.currentTurn });
    });

    socket.on('disconnect', () => {
        delete room.players[socket.id];
        room.currentTurn = 1;
        room.pendingGuess = null;
        io.emit('player-disconnected');
    });
});

// Render 等云平台会自动分配 PORT 环境变量，默认兜底 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
