import * as complaintsService from './complaints.service.js';

export async function raiseComplaintHandler(req, res) {
  const complaint = await complaintsService.raiseComplaint(req.body, {
    actorId: req.user.id, actorRole: req.user.role, ip: req.ip,
  });
  res.status(201).json({ complaint: complaint.toSafeJSON() });
}

export async function listMyComplaintsHandler(req, res) {
  const complaints = await complaintsService.listMyComplaints(req.user.id);
  res.json({ complaints: complaints.map((c) => c.toSafeJSON()) });
}

export async function listComplaintsHandler(req, res) {
  const complaints = await complaintsService.listComplaints({
    actorRole: req.user.role,
    actorCampIds: req.user.camp_ids,
    selectedCampId: req.validatedQuery?.camp_id,
    status: req.validatedQuery?.status,
  });
  res.json({ complaints: complaints.map((c) => c.toSafeJSON()) });
}

export async function reviewComplaintHandler(req, res) {
  const complaint = await complaintsService.reviewComplaint(req.params.id, req.body, {
    actorId: req.user.id, actorRole: req.user.role, actorCampIds: req.user.camp_ids, ip: req.ip,
  });
  res.json({ complaint: complaint.toSafeJSON() });
}
