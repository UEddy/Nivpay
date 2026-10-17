"""Trains the "Hey NivPay" classifier on the windows features.py made.

A small dense network, 1536 -> 128 -> 64 -> 1, in numpy (Adam, weighted
cross-entropy, dropout, noise on the inputs, weight decay, hard negatives).
The inputs' mean and spread are folded into the first layer, so the app runs
it as plain dense layers.

Usage: train.py <out.npz> <features.npz>... (a positive file's name contains "pos")
"""
import sys, numpy as np, time

rng = np.random.default_rng(0)

def load(paths):
    Xs, ys, ws, groups = [], [], [], []
    for gi, p in enumerate(paths):
        z = np.load(p)
        X, y, src = z["X"], z["y"].astype(np.float32), z["src"]
        # Confusable phrases count double: they are what a false wake sounds like.
        w = np.where(y > 0, 1.0, 2.0 if "conf" in p else 1.0).astype(np.float32)
        Xs.append(X.reshape(len(X), -1)); ys.append(y); ws.append(w); groups.append(gi * 1_000_000 + src)
        print(p, X.shape, int(y.sum()), flush=True)
    return np.concatenate(Xs), np.concatenate(ys), np.concatenate(ws), np.concatenate(groups)

class MLP:
    def __init__(self, sizes):
        self.W = [rng.standard_normal((o, i)).astype(np.float32) * np.sqrt(2 / i) for i, o in zip(sizes[:-1], sizes[1:])]
        self.b = [np.zeros(o, np.float32) for o in sizes[1:]]
        self.m = [np.zeros_like(p) for p in self.W + self.b]
        self.v = [np.zeros_like(p) for p in self.W + self.b]
        self.t = 0

    def forward(self, x, drop=0.0):
        acts = [x]
        for i, (W, b) in enumerate(zip(self.W, self.b)):
            z = acts[-1] @ W.T + b
            if i < len(self.W) - 1:
                z = np.maximum(z, 0)
                if drop: z = z * (rng.random(z.shape) >= drop) / (1 - drop)
            acts.append(z)
        return acts

    def step(self, x, y, w, lr, l2=1e-4, drop=0.3, noise=0.3):
        x = x + rng.standard_normal(x.shape).astype(np.float32) * noise
        acts = self.forward(x, drop)
        scale = 1 / (1 - drop) if drop else 1.0
        logit = acts[-1][:, 0]
        p = 1 / (1 + np.exp(-np.clip(logit, -30, 30)))
        loss = -np.sum(w * (y * np.log(p + 1e-7) + (1 - y) * np.log(1 - p + 1e-7))) / w.sum()
        g = ((p - y) * w / w.sum())[:, None].astype(np.float32)
        gW, gb = [], []
        for i in range(len(self.W) - 1, -1, -1):
            gW.insert(0, g.T @ acts[i] + l2 * self.W[i]); gb.insert(0, g.sum(0))
            # Through ReLU and dropout: the units that are on, scaled as they were.
            if i > 0: g = (g @ self.W[i]) * (acts[i] != 0) * scale
        self.t += 1
        params = self.W + self.b
        for k, (pa, gr) in enumerate(zip(params, gW + gb)):
            self.m[k] = 0.9 * self.m[k] + 0.1 * gr
            self.v[k] = 0.999 * self.v[k] + 0.001 * gr * gr
            mh = self.m[k] / (1 - 0.9 ** self.t); vh = self.v[k] / (1 - 0.999 ** self.t)
            pa -= lr * mh / (np.sqrt(vh) + 1e-8)
        return loss

    def score(self, X, mu, sd, bs=8192):
        out = []
        for i in range(0, len(X), bs):
            x = (X[i:i + bs].astype(np.float32) - mu) / sd
            out.append(1 / (1 + np.exp(-np.clip(self.forward(x)[-1][:, 0], -30, 30))))
        return np.concatenate(out)

def main(out, paths, epochs=8):
    X, y, w, groups = load(paths)
    # Clips, not windows, are split: no clip's windows on both sides.
    ug = np.unique(groups)
    val_groups = set(rng.choice(ug, len(ug) // 10, replace=False).tolist())
    is_val = np.array([g in val_groups for g in groups])
    tr, va = np.nonzero(~is_val)[0], np.nonzero(is_val)[0]
    mu = X[tr[:50000]].astype(np.float32).mean(0); sd = X[tr[:50000]].astype(np.float32).std(0) + 1e-3
    pos_w = (w[tr][y[tr] == 0].sum() / max(1, w[tr][y[tr] == 1].sum())) * 0.25
    w = np.where(y > 0, w * pos_w, w).astype(np.float32)
    net = MLP([X.shape[1], 128, 64, 1])
    bs = 1024
    hard = np.zeros(0, int)
    for ep in range(epochs):
        t = time.time()
        idx = np.concatenate([tr, hard])
        rng.shuffle(idx)
        lr = 1e-3 if ep < epochs - 3 else 3e-4
        losses = []
        for i in range(0, len(idx), bs):
            b = idx[i:i + bs]
            losses.append(net.step((X[b].astype(np.float32) - mu) / sd, y[b], w[b], lr))
        s_tr = net.score(X[tr], mu, sd)
        # Hard negatives: the training negatives scoring highest go round again, twice.
        neg = tr[y[tr] == 0]
        sn = s_tr[y[tr] == 0]
        top = neg[np.argsort(-sn)[: max(2000, len(neg) // 50)]]
        hard = np.concatenate([top, top]) if ep >= 2 else np.zeros(0, int)
        s_va = net.score(X[va], mu, sd)
        yv = y[va]
        msg = []
        for th in (0.5, 0.7, 0.8, 0.9, 0.95):
            rec = (s_va[yv == 1] >= th).mean(); fp = (s_va[yv == 0] >= th).mean()
            msg.append(f"th{th}: rec {rec:.3f} fp {fp:.5f}")
        print(f"ep {ep} loss {np.mean(losses):.4f} {time.time()-t:.0f}s | " + " | ".join(msg), flush=True)
    # Fold the inputs' mean and spread into the first layer.
    W0 = net.W[0] / sd[None, :]
    b0 = net.b[0] - W0 @ mu
    np.savez(out, w0=W0.astype(np.float32), b0=b0.astype(np.float32), w1=net.W[1], b1=net.b[1], w2=net.W[2], b2=net.b[2], window=16, threshold=0.5, hold=1)
    print("saved", out)

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
