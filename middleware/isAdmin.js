const isAdmin = (req, res, next) => {
  if (req.userDB.role !== "admin") {
    return res.status(403).json({ message: "Access denied. Admins only." });
  }
  next();
};

module.exports = isAdmin;
