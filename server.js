const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static assets from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// In-memory "database" of repair tickets and chat messages
let tickets = [
  {
    id: 'ENG-8021',
    customerName: 'Sarah Jenkins',
    deviceModel: 'iPhone 13 Pro',
    issueDescription: 'Cracked Screen & Battery Replacement',
    priority: 'P2',
    status: 'In Progress',
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
    messages: [
      {
        sender: 'staff',
        senderName: 'Floor Staff (Alex)',
        text: "Hello Sarah, we've received your iPhone 13 Pro. We are currently performing diagnostics on the screen and battery.",
        timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
      },
      {
        sender: 'customer',
        senderName: 'Sarah Jenkins',
        text: 'Thanks! Let me know if the battery needs a complete replacement or just a calibration.',
        timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()
      }
    ]
  },
  {
    id: 'ENG-9043',
    customerName: 'Marcus Vance',
    deviceModel: 'MacBook Pro 16" (2021)',
    issueDescription: 'Liquid Damage (Coffee Spill) Diagnosis',
    priority: 'P1',
    status: 'Diagnostics',
    createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
    messages: [
      {
        sender: 'customer',
        senderName: 'Marcus Vance',
        text: 'Hi, I spilled coffee on the keyboard this morning. The laptop shut down immediately and won\'t power on. Can you help?',
        timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
      },
      {
        sender: 'staff',
        senderName: 'Floor Staff (Jamie)',
        text: 'Hello Marcus, yes, we can definitely help. Please keep it powered off and do not try to charge it. Bring it in immediately so we can submerge it and clean the logic board.',
        timestamp: new Date(Date.now() - 2.5 * 60 * 60 * 1000).toISOString()
      }
    ]
  },
  {
    id: 'ENG-7732',
    customerName: 'Elena Rostova',
    deviceModel: 'PlayStation 5',
    issueDescription: 'HDMI Port Replacement & Deep Cleaning',
    priority: 'P3',
    status: 'Ready for Pickup',
    createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    messages: [
      {
        sender: 'staff',
        senderName: 'Floor Staff (Alex)',
        text: 'Hi Elena, the HDMI port has been successfully desoldered, replaced, and tested under load. Your PS5 is ready for pickup.',
        timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
      },
      {
        sender: 'customer',
        senderName: 'Elena Rostova',
        text: 'Awesome, thank you so much! I will swing by after work today around 6 PM.',
        timestamp: new Date(Date.now() - 3.5 * 60 * 60 * 1000).toISOString()
      }
    ]
  }
];

// Broadcast data to all connected WebSocket clients
function broadcast(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

wss.on('connection', (ws) => {
  console.log('[WebSocket] Client connected.');

  // Immediately send current tickets list to the client upon initial connection
  ws.send(JSON.stringify({ type: 'INIT_DATA', tickets }));

  ws.on('message', (messageString) => {
    try {
      const data = JSON.parse(messageString);
      
      switch (data.type) {
        case 'NEW_MESSAGE': {
          const { ticketId, sender, senderName, text } = data;
          const ticket = tickets.find(t => t.id === ticketId);
          if (ticket) {
            const newMessage = {
              sender,
              senderName,
              text,
              timestamp: new Date().toISOString()
            };
            ticket.messages.push(newMessage);
            
            // Broadcast the new message to all clients
            broadcast({
              type: 'MESSAGE_ADDED',
              ticketId,
              message: newMessage
            });
          }
          break;
        }

        case 'CREATE_TICKET': {
          const { customerName, deviceModel, issueDescription, priority } = data;
          const newTicket = {
            id: `ENG-${Math.floor(1000 + Math.random() * 9000)}`,
            customerName,
            deviceModel,
            issueDescription,
            priority,
            status: 'New',
            createdAt: new Date().toISOString(),
            messages: [
              {
                sender: 'system',
                senderName: 'System',
                text: `Ticket created for ${customerName} (${deviceModel}). Issue: ${issueDescription}`,
                timestamp: new Date().toISOString()
              }
            ]
          };
          tickets.unshift(newTicket); // Add to the top of the list
          
          // Broadcast the newly created ticket to everyone
          broadcast({
            type: 'TICKET_CREATED',
            ticket: newTicket
          });
          break;
        }

        case 'UPDATE_STATUS': {
          const { ticketId, status } = data;
          const ticket = tickets.find(t => t.id === ticketId);
          if (ticket) {
            ticket.status = status;
            
            // Broadcast the status update
            broadcast({
              type: 'STATUS_UPDATED',
              ticketId,
              status
            });
          }
          break;
        }

        case 'PING': {
          ws.send(JSON.stringify({ type: 'PONG' }));
          break;
        }

        default:
          console.warn('[WebSocket] Unknown message type:', data.type);
      }
    } catch (err) {
      console.error('[WebSocket] Error parsing client message:', err);
    }
  });

  ws.on('close', () => {
    console.log('[WebSocket] Client disconnected.');
  });
});

// Start the integrated HTTP and WS server
server.listen(PORT, () => {
  console.log(`[Server] Electronics Repair Chat running on http://localhost:${PORT}`);
});
