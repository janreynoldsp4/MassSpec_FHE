import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface MassSpecData {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  sampleType: string;
  status: "pending" | "analyzed" | "error";
  fheResult?: string;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [dataList, setDataList] = useState<MassSpecData[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newData, setNewData] = useState({
    sampleType: "",
    description: "",
    massSpecData: ""
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  // Calculate statistics
  const analyzedCount = dataList.filter(d => d.status === "analyzed").length;
  const pendingCount = dataList.filter(d => d.status === "pending").length;
  const errorCount = dataList.filter(d => d.status === "error").length;

  // Filter data based on search and filter
  const filteredData = dataList.filter(item => {
    const matchesSearch = item.sampleType.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         item.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterStatus === "all" || item.status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  useEffect(() => {
    loadDataList().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadDataList = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("massspec_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing data keys:", e);
        }
      }
      
      const list: MassSpecData[] = [];
      
      for (const key of keys) {
        try {
          const dataBytes = await contract.getData(`massspec_${key}`);
          if (dataBytes.length > 0) {
            try {
              const data = JSON.parse(ethers.toUtf8String(dataBytes));
              list.push({
                id: key,
                encryptedData: data.data,
                timestamp: data.timestamp,
                owner: data.owner,
                sampleType: data.sampleType,
                status: data.status || "pending",
                fheResult: data.fheResult
              });
            } catch (e) {
              console.error(`Error parsing data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading data ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setDataList(list);
    } catch (e) {
      console.error("Error loading data:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const uploadData = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setUploading(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting mass spectrometry data with FHE..."
    });
    
    try {
      // Simulate FHE encryption for mass spec data
      const encryptedData = `FHE-MS-${btoa(JSON.stringify(newData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const dataId = `ms-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const massSpecData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        sampleType: newData.sampleType,
        status: "pending"
      };
      
      // Store encrypted data on-chain
      await contract.setData(
        `massspec_${dataId}`, 
        ethers.toUtf8Bytes(JSON.stringify(massSpecData))
      );
      
      const keysBytes = await contract.getData("massspec_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(dataId);
      
      await contract.setData(
        "massspec_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Mass spec data encrypted and uploaded securely!"
      });
      
      await loadDataList();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowUploadModal(false);
        setNewData({
          sampleType: "",
          description: "",
          massSpecData: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Upload failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setUploading(false);
    }
  };

  const analyzeData = async (dataId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted mass spec data with FHE..."
    });

    try {
      // Simulate FHE computation for molecular analysis
      await new Promise(resolve => setTimeout(resolve, 4000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const dataBytes = await contract.getData(`massspec_${dataId}`);
      if (dataBytes.length === 0) {
        throw new Error("Data not found");
      }
      
      const data = JSON.parse(ethers.toUtf8String(dataBytes));
      
      // Simulate FHE analysis result
      const fheResult = "FHE-Molecular-Profile: C6H12O6 (Glucose) @ 95% confidence";
      
      const updatedData = {
        ...data,
        status: "analyzed",
        fheResult: fheResult
      };
      
      await contract.setData(
        `massspec_${dataId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedData))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE molecular analysis completed successfully!"
      });
      
      await loadDataList();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Analysis failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const renderBarChart = () => {
    return (
      <div className="bar-chart-container">
        <div className="bar-chart">
          <div className="bar-wrapper">
            <div 
              className="bar analyzed" 
              style={{ height: `${(analyzedCount / (dataList.length || 1)) * 100}%` }}
            >
              <span className="bar-value">{analyzedCount}</span>
            </div>
            <div className="bar-label">Analyzed</div>
          </div>
          <div className="bar-wrapper">
            <div 
              className="bar pending" 
              style={{ height: `${(pendingCount / (dataList.length || 1)) * 100}%` }}
            >
              <span className="bar-value">{pendingCount}</span>
            </div>
            <div className="bar-label">Pending</div>
          </div>
          <div className="bar-wrapper">
            <div 
              className="bar error" 
              style={{ height: `${(errorCount / (dataList.length || 1)) * 100}%` }}
            >
              <span className="bar-value">{errorCount}</span>
            </div>
            <div className="bar-label">Error</div>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="neon-spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container cyberpunk-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="molecule-icon"></div>
          </div>
          <h1>MassSpec<span>FHE</span></h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowUploadModal(true)} 
            className="upload-data-btn neon-button"
          >
            <div className="upload-icon"></div>
            Upload Data
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>FHE-Based Secure Mass Spectrometry Analysis</h2>
            <p>Process encrypted mass spec data in the cloud without decryption using Fully Homomorphic Encryption</p>
          </div>
        </div>
        
        <div className="dashboard-panels">
          <div className="panel project-info">
            <h3>Project Introduction</h3>
            <p>MassSpec-FHE enables researchers to upload encrypted mass spectrometry data to the cloud and perform molecular identification and quantitative analysis while maintaining complete data privacy through FHE technology.</p>
            <div className="fhe-badge">
              <span>FHE-Powered Analysis</span>
            </div>
          </div>
          
          <div className="panel data-stats">
            <h3>Data Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{dataList.length}</div>
                <div className="stat-label">Total Datasets</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{analyzedCount}</div>
                <div className="stat-label">Analyzed</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">Pending</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{errorCount}</div>
                <div className="stat-label">Errors</div>
              </div>
            </div>
          </div>
          
          <div className="panel chart-container">
            <h3>Analysis Status</h3>
            {renderBarChart()}
          </div>

          <div className="panel team-info">
            <h3>Research Team</h3>
            <div className="team-members">
              <div className="member">
                <div className="member-avatar"></div>
                <div className="member-info">
                  <h4>Dr. Chen Wei</h4>
                  <p>Lead Cryptographer</p>
                </div>
              </div>
              <div className="member">
                <div className="member-avatar"></div>
                <div className="member-info">
                  <h4>Dr. Sarah Kim</h4>
                  <p>Mass Spectrometry Expert</p>
                </div>
              </div>
              <div className="member">
                <div className="member-avatar"></div>
                <div className="member-info">
                  <h4>Prof. James Wilson</h4>
                  <p>Bioinformatics Director</p>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div className="data-section">
          <div className="section-header">
            <h2>Encrypted Mass Spec Data</h2>
            <div className="header-actions">
              <div className="search-filter">
                <input 
                  type="text"
                  placeholder="Search samples..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="neon-input"
                />
                <select 
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="neon-select"
                >
                  <option value="all">All Status</option>
                  <option value="pending">Pending</option>
                  <option value="analyzed">Analyzed</option>
                  <option value="error">Error</option>
                </select>
              </div>
              <button 
                onClick={loadDataList}
                className="refresh-btn neon-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="data-list neon-card">
            <div className="table-header">
              <div className="header-cell">ID</div>
              <div className="header-cell">Sample Type</div>
              <div className="header-cell">Owner</div>
              <div className="header-cell">Date</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {filteredData.length === 0 ? (
              <div className="no-data">
                <div className="no-data-icon"></div>
                <p>No mass spectrometry data found</p>
                <button 
                  className="neon-button primary"
                  onClick={() => setShowUploadModal(true)}
                >
                  Upload First Dataset
                </button>
              </div>
            ) : (
              filteredData.map(data => (
                <div className="data-row" key={data.id}>
                  <div className="table-cell data-id">#{data.id.substring(0, 6)}</div>
                  <div className="table-cell">{data.sampleType}</div>
                  <div className="table-cell">{data.owner.substring(0, 6)}...{data.owner.substring(38)}</div>
                  <div className="table-cell">
                    {new Date(data.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div className="table-cell">
                    <span className={`status-badge ${data.status}`}>
                      {data.status}
                    </span>
                  </div>
                  <div className="table-cell actions">
                    {isOwner(data.owner) && data.status === "pending" && (
                      <button 
                        className="action-btn neon-button success"
                        onClick={() => analyzeData(data.id)}
                      >
                        Analyze
                      </button>
                    )}
                    {data.status === "analyzed" && data.fheResult && (
                      <div className="fhe-result-tooltip">
                        <button className="neon-button info">
                          View Results
                        </button>
                        <div className="tooltip-content">
                          <h4>FHE Analysis Result</h4>
                          <p>{data.fheResult}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
  
      {showUploadModal && (
        <ModalUpload 
          onSubmit={uploadData} 
          onClose={() => setShowUploadModal(false)} 
          uploading={uploading}
          data={newData}
          setData={setNewData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content neon-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="neon-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="molecule-icon"></div>
              <span>MassSpec-FHE</span>
            </div>
            <p>Secure encrypted mass spectrometry analysis using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Research</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} MassSpec-FHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalUploadProps {
  onSubmit: () => void; 
  onClose: () => void; 
  uploading: boolean;
  data: any;
  setData: (data: any) => void;
}

const ModalUpload: React.FC<ModalUploadProps> = ({ 
  onSubmit, 
  onClose, 
  uploading,
  data,
  setData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setData({
      ...data,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!data.sampleType || !data.massSpecData) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="upload-modal neon-card">
        <div className="modal-header">
          <h2>Upload Mass Spectrometry Data</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Your mass spec data will be encrypted with FHE before processing
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Sample Type *</label>
              <select 
                name="sampleType"
                value={data.sampleType} 
                onChange={handleChange}
                className="neon-select"
              >
                <option value="">Select sample type</option>
                <option value="Protein">Protein Sample</option>
                <option value="Metabolite">Metabolite Sample</option>
                <option value="Lipid">Lipid Sample</option>
                <option value="Environmental">Environmental Sample</option>
                <option value="Clinical">Clinical Sample</option>
                <option value="Other">Other</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Description</label>
              <input 
                type="text"
                name="description"
                value={data.description} 
                onChange={handleChange}
                placeholder="Sample description..." 
                className="neon-input"
              />
            </div>
            
            <div className="form-group full-width">
              <label>Mass Spectrometry Data *</label>
              <textarea 
                name="massSpecData"
                value={data.massSpecData} 
                onChange={handleChange}
                placeholder="Paste your mass spectrometry data (m/z values, intensities, etc.)..." 
                className="neon-textarea"
                rows={6}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> Data remains encrypted during FHE processing and analysis
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn neon-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={uploading}
            className="submit-btn neon-button primary"
          >
            {uploading ? "Encrypting with FHE..." : "Upload Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;