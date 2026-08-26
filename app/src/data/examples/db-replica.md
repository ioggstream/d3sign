# Replicated database

To create a geographically replicated database
I setup 2 datacenters,
each with their networks.

```mermaid
---
id: hla
title: Replicated Database - Physical setup.
---
graph


subgraph dc-1[Data Center 1<br>d3f:Network d3f:PhysicalLocation]
    dc-1-net[d3f:Network]
end

subgraph dc-2[Data Center 2<br>d3f:Network d3f:PhysicalLocation]
    dc-2-net[d3f:Network]
end
```

Each datacenter d3f:Network has a d3f:VirtualizationSoftware hosting servers.

```mermaid
---
title: DataCenters
---
graph

subgraph dc-1-net[192.168.1.0/24 d3f:Network]
    dc-1-vm[OpenStack d3f:VirtualizationSoftware]
end

subgraph dc-2-net[192.168.2.0/24 d3f:Network]
    dc-2-vm[OpenStack d3f:VirtualizationSoftware]
end
```

Datacenter offers DNS and NTP facilities to the servers.

```mermaid
---
id: hla
---
graph
subgraph dc-1
    %% d3fend does not have d3f:DNSService nor d3f:NetworkTimeService, so we use the servers instead.
    dc-1-dns[d3f:DNSServer]
    dc-1-ntp[d3f:NetworkTimeServer]
end

subgraph dc-2
    dc-2-dns[d3f:DNSServer]
    dc-2-ntp[d3f:NetworkTimeServer]
end
```

I provision two d3f:DatabaseServer, one in each datacenter, and configure them to replicate data between each other.

```mermaid
---
title: Database replication
---
graph

subgraph dc-1-vm[OpenStack d3f:VirtualizationSoftware]
    db-1[MySQL d3f:DatabaseServer]
end

subgraph dc-2-vm[OpenStack d3f:VirtualizationSoftware]
    db-2[MySQL d3f:DatabaseServer]
end

subgraph db-1[MySQL d3f:DatabaseServer]
    db-1-service[d3f:DatabaseService]
    db-1-volume[d3f:Volume]
    db-1-config[d3f:ConfigurationFile]
    db-1-logs[d3f:LogFile]
    db-1-port[d3f:IPAddress]
end

subgraph db-2[MySQL d3f:DatabaseServer]
    db-2-service[d3f:DatabaseService]
    db-2-volume[d3f:Volume]
    db-2-config[d3f:ConfigurationFile]
    db-2-logs[d3f:LogFile]
    db-2-port[d3f:IPAddress]
end

db-1-service -->|d3f:accesses| db-2-service
db-2-service -->|d3f:accesses| db-1-service
```

I can further detail the replication configuration

```mermaid
---
id: replication
---
graph

db-1-service -->|d3f:writes| db-1-logs
db-1-service -->|d3f:accesses| db-1-volume
db-1-service -->|d3f:reads| db-1-config
db-1-port -->|d3f:used-by| db-1-service


subgraph db-1
db-1-binlog[binlog d3f:LogFile]
db-1-sync[d3f:Process]
db-1-sync -->|d3f:writes| db-1-volume
db-1-service -->|d3f:produces| db-1-binlog

end
subgraph db-2
db-2-binlog[binlog d3f:LogFile]
db-2-sync[d3f:Process]
db-2-sync -->|d3f:writes| db-2-volume
db-2-service -->|d3f:produces| db-2-binlog
end
db-2-sync -->|d3f:reads| db-1-binlog
db-1-sync -->|d3f:reads| db-2-binlog

db-2-service -->|d3f:writes| db-2-logs
db-2-service -->|d3f:accesses| db-2-volume
db-2-service -->|d3f:reads| db-2-config
db-2-port -->|d3f:used-by| db-2-service
```

A d3f:ClientApplication uses a d3f:DatabaseService
and backs it up to dpv:back
d3f:Record
d3f:File
d3f:WebResourceAccess
