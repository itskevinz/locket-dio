const directFriendRoutes = require("./routes/directFriendRoutes");
const {
  sendDirectFriendRequestController,
} = require("./controllers/directFriendController");
const {
  SendToFriendRequestDirect,
  getDirectRelationshipStatus,
  waitForVerifiedDirectRelationship,
  normalizeRelationshipValue,
} = require("./services/directFriendService");
const {
  instanceLocketDirect,
  createDirectClient,
  getDirectHeaders,
} = require("../../libs/instanceLocketDirect");

module.exports = {
  directFriendRoutes,
  sendDirectFriendRequestController,
  SendToFriendRequestDirect,
  sendDirectFriendRequest: SendToFriendRequestDirect,
  getDirectRelationshipStatus,
  waitForVerifiedDirectRelationship,
  normalizeRelationshipValue,
  instanceLocketDirect,
  createDirectClient,
  getDirectHeaders,
};
