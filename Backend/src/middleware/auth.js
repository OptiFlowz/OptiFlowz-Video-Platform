import jwt from "jsonwebtoken";

export function requireAuth(req,res, next){
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if(!token) return res.status(401).json({message: "Missing token"});

    try{
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        req.user = payload;
        next();
    }catch{
        return res.status(401).json({message: "Invalid token"});
    }
}

export function requireAdmin(req, res, next) {
    if (req.user.role !== 'admin' && req.user.role !== 'uploader') {
        return res.status(403).json({ message: 'Insufficient permissions' });
    }
    next();
}

export function optionalAuth(req, res, next) {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;

    if (!token) {
        req.user = null;
        return next();
    }

    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        req.user = payload;
    } catch {
        req.user = null; // token postoji ali je loš → tretiraj kao neulogovanog
    }

    next();
}
