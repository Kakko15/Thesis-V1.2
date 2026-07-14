from fastapi import APIRouter, Depends, HTTPException
from dependencies.auth import require_superadmin, sb
from models import DepartmentCreate, DepartmentUpdate, DepartmentOut

router = APIRouter(prefix="/departments", tags=["Departments"])

@router.get("/", response_model=list[DepartmentOut])
def list_departments():
    """Fetch all dynamic departments. Publicly accessible for signups and filters."""
    res = sb.table('departments').select('*').order('created_at', desc=False).execute()
    return res.data

@router.post("/", response_model=DepartmentOut)
def create_department(body: DepartmentCreate, user=Depends(require_superadmin)):
    """Create a new department with its tracks."""
    existing = sb.table('departments').select('id').eq('name', body.name).execute()
    if existing.data:
        raise HTTPException(status_code=400, detail="Department with this name already exists")
    
    insert_data = {
        'name': body.name,
        'track_label': body.track_label,
        'tracks': body.tracks,
    }
    res = sb.table('departments').insert(insert_data).execute()
    return res.data[0]

@router.put("/{department_id}", response_model=DepartmentOut)
def update_department(department_id: str, body: DepartmentUpdate, user=Depends(require_superadmin)):
    """Update an existing department."""
    existing = sb.table('departments').select('*').eq('id', department_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Department not found")
        
    update_data = {}
    if body.name is not None:
        # Check if new name conflicts with another department
        if body.name != existing.data[0]['name']:
            conflict = sb.table('departments').select('id').eq('name', body.name).execute()
            if conflict.data:
                raise HTTPException(status_code=400, detail="Department with this name already exists")
        update_data['name'] = body.name
    if body.track_label is not None:
        update_data['track_label'] = body.track_label
    if body.tracks is not None:
        update_data['tracks'] = body.tracks

    if not update_data:
        return existing.data[0]

    res = sb.table('departments').update(update_data).eq('id', department_id).execute()
    return res.data[0]

@router.delete("/{department_id}")
def delete_department(department_id: str, user=Depends(require_superadmin)):
    """Delete a department."""
    existing = sb.table('departments').select('*').eq('id', department_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Department not found")
        
    sb.table('departments').delete().eq('id', department_id).execute()
    return {"message": "Department deleted successfully"}
