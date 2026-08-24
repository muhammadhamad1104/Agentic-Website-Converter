import { motion } from 'framer-motion';
import { Cpu, Users, Activity, HardDrive, ShieldAlert } from 'lucide-react';
import Navbar from '../../components/Navbar/Navbar';
import Scene3D from '../../components/Scene3D/Scene3D';
import { fadeInUp, staggerContainer } from '@design/animations';
import './AdminDashboard.css';

export default function AdminDashboard() {
  return (
    <div className="admin-page" style={{ position: 'relative', minHeight: '100vh' }}>
      <Scene3D />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <Navbar />
        
        <main className="admin-main container">
          <div className="admin-header">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">Admin Dashboard</h1>
              <p className="text-gray-400">System overview and analytics</p>
            </div>
          </div>

          <motion.div 
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12"
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
          >
            <motion.div className="glass p-6 rounded-2xl flex flex-col gap-4 border-t-4 border-t-indigo-500" variants={fadeInUp}>
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-gray-400 font-medium mb-1">Total Users</h3>
                  <p className="text-3xl font-bold text-white">1,248</p>
                </div>
                <div className="w-10 h-10 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
                  <Users size={20} />
                </div>
              </div>
              <div className="text-sm text-indigo-300">+12% from last month</div>
            </motion.div>

            <motion.div className="glass p-6 rounded-2xl flex flex-col gap-4 border-t-4 border-t-indigo-400" variants={fadeInUp}>
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-gray-400 font-medium mb-1">Jobs Processed</h3>
                  <p className="text-3xl font-bold text-white">8,432</p>
                </div>
                <div className="w-10 h-10 rounded-lg bg-indigo-500/15 text-indigo-300 flex items-center justify-center">
                  <Activity size={20} />
                </div>
              </div>
              <div className="text-sm text-indigo-300">+24% from last month</div>
            </motion.div>

            <motion.div className="glass p-6 rounded-2xl flex flex-col gap-4 border-t-4 border-t-indigo-300" variants={fadeInUp}>
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-gray-400 font-medium mb-1">Agent Memory</h3>
                  <p className="text-3xl font-bold text-white">42%</p>
                </div>
                <div className="w-10 h-10 rounded-lg bg-indigo-500/10 text-indigo-300 flex items-center justify-center">
                  <HardDrive size={20} />
                </div>
              </div>
              <div className="text-sm text-gray-400">1.2 TB available</div>
            </motion.div>

            <motion.div className="glass p-6 rounded-2xl flex flex-col gap-4 border-t-4 border-t-indigo-200" variants={fadeInUp}>
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-gray-400 font-medium mb-1">Failed Jobs</h3>
                  <p className="text-3xl font-bold text-white">24</p>
                </div>
                <div className="w-10 h-10 rounded-lg bg-indigo-500/10 text-indigo-200 flex items-center justify-center">
                  <ShieldAlert size={20} />
                </div>
              </div>
              <div className="text-sm text-indigo-200/60">-5% from last month</div>
            </motion.div>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="glass rounded-2xl p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-white">Agent Load</h2>
                <Cpu className="text-gray-400" />
              </div>
              <div className="h-64 flex items-center justify-center border border-dashed border-gray-700 rounded-xl text-gray-500">
                Recharts Area Chart Goes Here
              </div>
            </div>
            
            <div className="glass rounded-2xl p-6">
              <h2 className="text-xl font-bold text-white mb-6">Recent Users</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="py-3 px-4 text-gray-400 font-medium">User</th>
                      <th className="py-3 px-4 text-gray-400 font-medium">Joined</th>
                      <th className="py-3 px-4 text-gray-400 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-gray-800/50 hover:bg-gray-800/20 transition-colors">
                      <td className="py-3 px-4 text-white">alice@example.com</td>
                      <td className="py-3 px-4 text-gray-400">2 mins ago</td>
                      <td className="py-3 px-4"><span className="status-badge status-completed">Active</span></td>
                    </tr>
                    <tr className="border-b border-gray-800/50 hover:bg-gray-800/20 transition-colors">
                      <td className="py-3 px-4 text-white">bob@corp.io</td>
                      <td className="py-3 px-4 text-gray-400">1 hour ago</td>
                      <td className="py-3 px-4"><span className="status-badge status-completed">Active</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
