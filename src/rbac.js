const rank = {
  OWNER: 5,
  ADMIN: 4,
  FINANCE: 3,
  SALES: 2,
  ACCOUNTANT: 2,
  VIEWER: 1
};

export function requireRole(minRole) {
  return (req, res, next) => {
    const r = req.org?.role;
    if (!r) return res.status(403).json({ error: "missing_org_context" });
    if ((rank[r] || 0) < (rank[minRole] || 0)) {
      return res.status(403).json({ error: "forbidden" });
    }
    next();
  };
}
