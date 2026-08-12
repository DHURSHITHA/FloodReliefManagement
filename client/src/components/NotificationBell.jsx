import { useState } from 'react';
import { Badge, Box, IconButton, Menu, MenuItem, Typography } from '@mui/material';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import { useNotifications, useMarkNotificationRead } from '../api/dashboard.js';

export function NotificationBell() {
  const { data: notifications = [] } = useNotifications();
  const markRead = useMarkNotificationRead();
  const [anchorEl, setAnchorEl] = useState(null);
  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <Box>
      <IconButton onClick={(e) => setAnchorEl(e.currentTarget)} aria-label="Notifications" size="small">
        <Badge badgeContent={unreadCount} color="error">
          <NotificationsNoneIcon />
        </Badge>
      </IconButton>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        {notifications.length === 0 && <MenuItem disabled>No notifications</MenuItem>}
        {notifications.map((n) => (
          <MenuItem
            key={n.id}
            onClick={() => markRead.mutate(n.id)}
            sx={{ opacity: n.read ? 0.55 : 1, maxWidth: 360, whiteSpace: 'normal' }}
          >
            <Typography variant="body2">{n.message}</Typography>
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}
